'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface OsirisMapProps {
  data: any;
  activeLayers: Record<string, boolean>;
  onEntityClick?: (entity: any) => void;
  onMouseCoords?: (coords: { lat: number; lng: number }) => void;
  onRightClick?: (coords: { lat: number; lng: number }) => void;
  onViewStateChange?: (vs: { zoom: number; latitude: number }) => void;
  flyToLocation?: { lat: number; lng: number; ts: number } | null;
  projection?: 'mercator' | 'globe';
  mapStyle?: string;
  sweepData?: any;
  scanTargets?: any[];
}

function computeSolarTerminator(): [number, number][] {
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const decRad = declination * Math.PI / 180;
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const subsolarLng = (12 - utcHours) * 15;
  const points: [number, number][] = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const lngRad = (lng - subsolarLng) * Math.PI / 180;
    const lat = Math.atan(-Math.cos(lngRad) / Math.tan(decRad)) * 180 / Math.PI;
    points.push([lng, lat]);
  }
  const darkSide = declination >= 0 ? -90 : 90;
  points.push([180, darkSide]);
  points.push([-180, darkSide]);
  points.push(points[0]);
  return points;
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };
const COUNTRY_GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const US_STATES_GEOJSON_URL = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';
const BASE_CHOROPLETH_LAYERS = ['country-color-fill', 'country-color-outline', 'us-state-color-fill', 'us-state-color-outline'];

function OsirisMap({ data, activeLayers, onEntityClick, onMouseCoords, onRightClick, onViewStateChange, flyToLocation, projection = 'globe', mapStyle = 'dark', sweepData, scanTargets = [] }: OsirisMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const prevStyleRef = useRef(mapStyle);

  // Create aircraft icon on canvas (for WebGL symbol layer)
  const createIcon = useCallback((map: maplibregl.Map, id: string, color: string, size: number) => {
    if (map.hasImage(id)) return;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2, cy = size / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.4);
    ctx.lineTo(cx - size * 0.12, cy + size * 0.1);
    ctx.lineTo(cx - size * 0.4, cy + size * 0.2);
    ctx.lineTo(cx - size * 0.4, cy + size * 0.3);
    ctx.lineTo(cx - size * 0.12, cy + size * 0.15);
    ctx.lineTo(cx, cy + size * 0.35);
    ctx.lineTo(cx + size * 0.12, cy + size * 0.15);
    ctx.lineTo(cx + size * 0.4, cy + size * 0.3);
    ctx.lineTo(cx + size * 0.4, cy + size * 0.2);
    ctx.lineTo(cx + size * 0.12, cy + size * 0.1);
    ctx.closePath();
    ctx.fill();
    map.addImage(id, { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data) });
  }, []);

  const createDot = useCallback((map: maplibregl.Map, id: string, color: string, size: number) => {
    if (map.hasImage(id)) return;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2 - 1, 0, Math.PI * 2);
    ctx.fill();
    map.addImage(id, { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data) });
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-98.5, 45.5], zoom: 2.8, minZoom: 1.5, maxZoom: 18,
      attributionControl: false,
      maxPitch: 85,
    });

    map.on('load', () => {
      mapRef.current = map;
      // Create icons
      createIcon(map, 'plane-cyan', '#00E5FF', 24);
      createIcon(map, 'plane-green', '#00E676', 24);
      createIcon(map, 'plane-pink', '#FF69B4', 24);
      createIcon(map, 'plane-red', '#FF3D3D', 24);
      createIcon(map, 'plane-grey', '#555555', 24);
      createDot(map, 'dot-gold', '#D4AF37', 8);
      createDot(map, 'dot-red', '#FF3D3D', 10);
      createDot(map, 'dot-orange', '#FF9500', 10);
      createDot(map, 'dot-green', '#00E676', 10);
      createDot(map, 'dot-fire', '#FF6B00', 10);
      createDot(map, 'dot-cctv', '#39FF14', 10);

      // Sources
      const sources = ['flights','military','jets','private-fl','satellites','earthquakes','gdelt','gps-jamming','day-night','cctv','fires','weather','infrastructure','hud-pha-flows','sbir-recipients','education-orgs','workforce-orgs','health-orgs','funded-faith-orgs','sikeston-businesses','sikeston-events','federal-power','power-edges','maritime','maritime-choke','maritime-ships','live-news','sigint-news','conflict-zones', 'war-alerts-targets', 'war-alerts-lines', 'balloons', 'radiation', 'ip-sweep-devices', 'ip-sweep-pulse', 'ip-sweep-connections', 'scan-targets'];
      sources.forEach(s => map.addSource(s, { type: 'geojson', data: EMPTY_FC }));

      map.addSource('country-color-areas', { type: 'geojson', data: COUNTRY_GEOJSON_URL });
      map.addSource('us-state-color-areas', { type: 'geojson', data: US_STATES_GEOJSON_URL });
      map.addLayer({ id: 'country-color-fill', type: 'fill', source: 'country-color-areas', paint: {
        'fill-color': ['match', ['get', 'ISO3166-1-Alpha-2'],
          ['US', 'CA', 'MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA', 'CU', 'HT', 'DO', 'JM', 'BS', 'TT'], '#1E88E5',
          ['BR', 'AR', 'CL', 'PE', 'CO', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR', 'GF'], '#43A047',
          ['GB', 'IE', 'FR', 'DE', 'ES', 'PT', 'IT', 'NL', 'BE', 'CH', 'AT', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'SE', 'NO', 'FI', 'DK', 'UA'], '#8E44AD',
          ['MA', 'DZ', 'TN', 'LY', 'EG', 'SD', 'ET', 'KE', 'TZ', 'UG', 'NG', 'GH', 'CI', 'SN', 'ML', 'NE', 'ZA', 'AO', 'MZ', 'CD'], '#F39C12',
          ['CN', 'JP', 'KR', 'KP', 'IN', 'PK', 'BD', 'TH', 'VN', 'LA', 'KH', 'MM', 'MY', 'SG', 'ID', 'PH', 'IR', 'IQ', 'SA', 'AE', 'IL', 'TR'], '#D81B60',
          ['AU', 'NZ', 'PG', 'FJ', 'SB', 'VU', 'NC'], '#00ACC1',
          '#5E6A75'
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.16, 4, 0.12, 7, 0.07],
      }});
      map.addLayer({ id: 'country-color-outline', type: 'line', source: 'country-color-areas', paint: {
        'line-color': '#FFFFFF',
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.18, 4, 0.34, 7, 0.2],
        'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.45, 4, 0.8, 7, 0.45],
      }});
      map.addLayer({ id: 'us-state-color-fill', type: 'fill', source: 'us-state-color-areas', minzoom: 2, paint: {
        'fill-color': ['match', ['get', 'name'],
          'California', '#2F80ED', 'Texas', '#EB5757', 'Florida', '#F2994A', 'New York', '#9B51E0',
          'Washington', '#27AE60', 'Oregon', '#6FCF97', 'Nevada', '#BB6BD9', 'Arizona', '#F2C94C',
          'New Mexico', '#56CCF2', 'Colorado', '#00AEEF', 'Illinois', '#B388FF', 'Georgia', '#FF6B6B',
          'North Carolina', '#4ECDC4', 'Virginia', '#A3E635', 'Pennsylvania', '#D4AF37', 'Ohio', '#00E676',
          '#6B7280'
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.18, 5, 0.12, 8, 0.06],
      }});
      map.addLayer({ id: 'us-state-color-outline', type: 'line', source: 'us-state-color-areas', minzoom: 2, paint: {
        'line-color': '#F8FAFC',
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.28, 5, 0.48, 8, 0.24],
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 5, 1.1, 8, 0.6],
      }});

      // ── CONFLICT ZONES — small warning markers (not polygons) ──
      // Create warning triangle icon
      const warnSize = 20;
      const warnCanvas = document.createElement('canvas');
      warnCanvas.width = warnSize; warnCanvas.height = warnSize;
      const warnCtx = warnCanvas.getContext('2d')!;
      // Triangle
      warnCtx.fillStyle = '#FF1744';
      warnCtx.beginPath();
      warnCtx.moveTo(warnSize/2, 1);
      warnCtx.lineTo(warnSize - 1, warnSize - 1);
      warnCtx.lineTo(1, warnSize - 1);
      warnCtx.closePath();
      warnCtx.fill();
      // Exclamation mark
      warnCtx.fillStyle = '#000';
      warnCtx.font = 'bold 11px sans-serif';
      warnCtx.textAlign = 'center';
      warnCtx.fillText('!', warnSize/2, warnSize - 4);
      map.addImage('warn-icon', { width: warnSize, height: warnSize, data: new Uint8Array(warnCtx.getImageData(0, 0, warnSize, warnSize).data) });

      // Orange warning
      const warnOCanvas = document.createElement('canvas');
      warnOCanvas.width = warnSize; warnOCanvas.height = warnSize;
      const warnOCtx = warnOCanvas.getContext('2d')!;
      warnOCtx.fillStyle = '#FF9500';
      warnOCtx.beginPath();
      warnOCtx.moveTo(warnSize/2, 1);
      warnOCtx.lineTo(warnSize - 1, warnSize - 1);
      warnOCtx.lineTo(1, warnSize - 1);
      warnOCtx.closePath();
      warnOCtx.fill();
      warnOCtx.fillStyle = '#000';
      warnOCtx.font = 'bold 11px sans-serif';
      warnOCtx.textAlign = 'center';
      warnOCtx.fillText('!', warnSize/2, warnSize - 4);
      map.addImage('warn-orange', { width: warnSize, height: warnSize, data: new Uint8Array(warnOCtx.getImageData(0, 0, warnSize, warnSize).data) });

      // Yellow warning
      const warnYCanvas = document.createElement('canvas');
      warnYCanvas.width = warnSize; warnYCanvas.height = warnSize;
      const warnYCtx = warnYCanvas.getContext('2d')!;
      warnYCtx.fillStyle = '#FFD500';
      warnYCtx.beginPath();
      warnYCtx.moveTo(warnSize/2, 1);
      warnYCtx.lineTo(warnSize - 1, warnSize - 1);
      warnYCtx.lineTo(1, warnSize - 1);
      warnYCtx.closePath();
      warnYCtx.fill();
      warnYCtx.fillStyle = '#000';
      warnYCtx.font = 'bold 11px sans-serif';
      warnYCtx.textAlign = 'center';
      warnYCtx.fillText('!', warnSize/2, warnSize - 4);
      map.addImage('warn-yellow', { width: warnSize, height: warnSize, data: new Uint8Array(warnYCtx.getImageData(0, 0, warnSize, warnSize).data) });

      map.addLayer({ id: 'conflict-icons', type: 'symbol', source: 'conflict-zones', layout: {
        'icon-image': ['match', ['get','severity'], 'war','warn-icon', 'high','warn-orange', 'warn-yellow'],
        'icon-size': ['interpolate',['linear'],['zoom'], 1,0.6, 4,0.8, 8,1],
        'icon-allow-overlap': true,
        'text-field': ['get','label'],
        'text-size': ['interpolate',['linear'],['zoom'], 1,7, 4,9, 8,11],
        'text-font': ['Open Sans Bold'],
        'text-offset': [0, 1.4],
        'text-allow-overlap': false,
      }, paint: {
        'text-color': ['match', ['get','severity'], 'war','#FF1744', 'high','#FF9500', '#FFD500'],
        'text-halo-color': '#000', 'text-halo-width': 1.5, 'text-opacity': 0.9,
      }});


      // Day/Night
      map.addLayer({ id: 'day-night-fill', type: 'fill', source: 'day-night', paint: { 'fill-color': '#000022', 'fill-opacity': 0.35 }});

      // Earthquakes
      map.addLayer({ id: 'eq-circles', type: 'circle', source: 'earthquakes', paint: {
        'circle-radius': ['interpolate',['linear'],['get','magnitude'], 2.5,4, 5,12, 7,24],
        'circle-color': ['interpolate',['linear'],['get','magnitude'], 2.5,'#FFD700', 4,'#FF9500', 6,'#FF1744'],
        'circle-opacity': 0.6, 'circle-blur': 0.3, 'circle-stroke-width': 1, 'circle-stroke-color': '#FFD700', 'circle-stroke-opacity': 0.3,
      }});
      map.addLayer({ id: 'eq-label', type: 'symbol', source: 'earthquakes', filter: ['>=',['get','magnitude'],4.5], layout: {
        'text-field': ['concat','M',['to-string',['get','magnitude']]], 'text-size': 9, 'text-font': ['Open Sans Regular'], 'text-offset': [0,1.5],
      }, paint: { 'text-color': '#FFD700', 'text-halo-color': '#000', 'text-halo-width': 1 }});

      // Fires
      map.addLayer({ id: 'fires-heat', type: 'circle', source: 'fires', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,2, 5,4, 10,8],
        'circle-color': '#FF6B00', 'circle-opacity': 0.5, 'circle-blur': 0.5,
      }});

      // CCTV — outer glow ring
      map.addLayer({ id: 'cctv-glow', type: 'circle', source: 'cctv', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,5, 5,8, 10,14, 14,20],
        'circle-color': '#39FF14', 'circle-opacity': 0.08, 'circle-blur': 1,
      }});
      // CCTV — main dot
      map.addLayer({ id: 'cctv-dots', type: 'circle', source: 'cctv', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,3, 5,5, 10,8, 14,12],
        'circle-color': '#39FF14', 'circle-opacity': 0.8,
        'circle-stroke-width': 2, 'circle-stroke-color': '#39FF14', 'circle-stroke-opacity': 0.5,
      }});
      // CCTV — labels at zoom 10+
      map.addLayer({ id: 'cctv-label', type: 'symbol', source: 'cctv', minzoom: 10, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.8], 'text-max-width': 12, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#39FF14', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.7 }});

      // GDELT
      map.addLayer({ id: 'gdelt-dots', type: 'circle', source: 'gdelt', paint: {
        'circle-radius': 4, 'circle-color': '#FF3D3D', 'circle-opacity': 0.5, 'circle-stroke-width': 1, 'circle-stroke-color': '#FF3D3D', 'circle-stroke-opacity': 0.3,
      }});

      // GPS Jamming
      map.addLayer({ id: 'jam-fill', type: 'circle', source: 'gps-jamming', paint: { 'circle-radius': 30, 'circle-color': '#FF0000', 'circle-opacity': 0.15, 'circle-blur': 1 }});
      map.addLayer({ id: 'jam-label', type: 'symbol', source: 'gps-jamming', layout: {
        'text-field': ['concat','GPS JAM ',['to-string',['get','severity']],'%'], 'text-size': 10, 'text-font': ['Open Sans Bold'], 'text-allow-overlap': true,
      }, paint: { 'text-color': '#FF4444', 'text-halo-color': '#000', 'text-halo-width': 1 }});

      // Weather Events (NASA EONET — storms, volcanoes)
      map.addLayer({ id: 'weather-glow', type: 'circle', source: 'weather', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,12, 5,20, 10,30],
        'circle-color': '#E040FB', 'circle-opacity': 0.1, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'weather-dots', type: 'circle', source: 'weather', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,5, 5,8, 10,14],
        'circle-color': ['match', ['get','icon'], 'cyclone','#E040FB', 'volcano','#FF1744', '#E040FB'],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2, 'circle-stroke-color': '#E040FB', 'circle-stroke-opacity': 0.4,
      }});
      map.addLayer({ id: 'weather-label', type: 'symbol', source: 'weather', layout: {
        'text-field': ['get','title'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 2], 'text-max-width': 14, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#E040FB', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.8 }});

      // Nuclear Infrastructure
      map.addLayer({ id: 'infra-glow', type: 'circle', source: 'infrastructure', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,8, 5,14, 10,22],
        'circle-color': '#76FF03', 'circle-opacity': 0.08, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'infra-dots', type: 'circle', source: 'infrastructure', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,4, 5,6, 10,10],
        'circle-color': ['match', ['get','status'], 'Active Conflict Zone','#FF1744', 'Destroyed / Decommissioning','#757575', '#76FF03'],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2, 'circle-stroke-color': '#76FF03', 'circle-stroke-opacity': 0.4,
      }});
      map.addLayer({ id: 'infra-label', type: 'symbol', source: 'infrastructure', minzoom: 5, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 2], 'text-max-width': 14, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#76FF03', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.7 }});

      map.addLayer({ id: 'hud-pha-bubbles', type: 'circle', source: 'hud-pha-flows', paint: {
        'circle-radius': ['interpolate',['linear'],['get','flow_score'], 0,3, 20,5, 50,10, 75,16, 100,25],
        'circle-color': ['match', ['get','flow_bucket'], 'fresh','#00E676', 'active','#00AEEF', 'aging','#D4AF37', 'dormant','#6B7280', '#00AEEF'],
        'circle-opacity': ['interpolate',['linear'],['get','recency_score'], 0,0.22, 50,0.42, 100,0.72],
        'circle-stroke-width': ['interpolate',['linear'],['get','award_count'], 0,1, 5,2, 25,3.5],
        'circle-stroke-color': ['match', ['get','flow_bucket'], 'fresh','#B7FFCF', 'active','#E6F7FF', 'aging','#FFE7A3', 'dormant','#9CA3AF', '#FFFFFF'],
        'circle-stroke-opacity': 0.62,
      }});
      map.addLayer({ id: 'hud-pha-label', type: 'symbol', source: 'hud-pha-flows', minzoom: 4, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Bold'],
        'text-offset': [0, 1.8], 'text-allow-overlap': false,
      }, paint: { 'text-color': '#E6F7FF', 'text-halo-color': '#001018', 'text-halo-width': 1 }});

      map.addLayer({ id: 'sbir-recipient-glow', type: 'circle', source: 'sbir-recipients', paint: {
        'circle-radius': ['interpolate',['linear'],['get','opportunity_score'], 0,5, 35,12, 70,22, 100,34],
        'circle-color': ['match', ['get','activity_bucket'], 'hot','#00E676', 'warm','#F2C94C', 'steady','#00AEEF', 'dormant','#6B7280', '#F2C94C'],
        'circle-opacity': ['interpolate',['linear'],['zoom'], 1,0.16, 4,0.1, 8,0.03],
        'circle-blur': 1.1,
      }});
      map.addLayer({ id: 'sbir-recipient-dots', type: 'circle', source: 'sbir-recipients', paint: {
        'circle-radius': ['interpolate',['linear'],['get','total_awarded'], 0,2.5, 250000,4, 1000000,7, 5000000,12, 20000000,18],
        'circle-color': ['match', ['get','activity_bucket'], 'hot','#00E676', 'warm','#F2C94C', 'steady','#00AEEF', 'dormant','#6B7280', '#F2C94C'],
        'circle-opacity': ['interpolate',['linear'],['get','recency_score'], 0,0.26, 50,0.55, 100,0.82],
        'circle-stroke-width': ['interpolate',['linear'],['get','award_count'], 1,0.7, 10,1.6, 50,2.8],
        'circle-stroke-color': '#FFF7CC',
        'circle-stroke-opacity': 0.72,
      }});
      map.addLayer({ id: 'sbir-recipient-label', type: 'symbol', source: 'sbir-recipients', minzoom: 6, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Bold'],
        'text-offset': [0, 1.5], 'text-allow-overlap': false,
      }, paint: { 'text-color': '#FFF7CC', 'text-halo-color': '#100F08', 'text-halo-width': 1 }});

      const addCapabilityLayer = (prefix: string, source: string, color: string) => {
        map.addLayer({ id: `${prefix}-glow`, type: 'circle', source, paint: {
          'circle-radius': ['interpolate',['linear'],['zoom'], 1,6, 5,12, 9,20],
          'circle-color': color,
          'circle-opacity': ['interpolate',['linear'],['zoom'], 1,0.14, 6,0.07, 10,0.03],
          'circle-blur': 1,
        }});
        map.addLayer({ id: `${prefix}-dots`, type: 'circle', source, paint: {
          'circle-radius': ['interpolate',['linear'],['get','node_weight'], 0,3, 25,5, 75,8, 150,12],
          'circle-color': color,
          'circle-opacity': 0.78,
          'circle-stroke-width': 1.4,
          'circle-stroke-color': '#050505',
          'circle-stroke-opacity': 0.8,
        }});
        map.addLayer({ id: `${prefix}-label`, type: 'symbol', source, minzoom: 6, layout: {
          'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
          'text-offset': [0, 1.5], 'text-max-width': 12, 'text-allow-overlap': false,
        }, paint: { 'text-color': color, 'text-halo-color': '#000', 'text-halo-width': 1 }});
      };
      addCapabilityLayer('education-org', 'education-orgs', '#56CCF2');
      addCapabilityLayer('workforce-org', 'workforce-orgs', '#00E676');
      addCapabilityLayer('health-org', 'health-orgs', '#FF4081');
      addCapabilityLayer('funded-faith-org', 'funded-faith-orgs', '#FFF7CC');

      map.addLayer({ id: 'sikeston-business-glow', type: 'circle', source: 'sikeston-businesses', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 8,8, 12,14, 15,20],
        'circle-color': '#00D1B2',
        'circle-opacity': ['interpolate',['linear'],['zoom'], 8,0.12, 14,0.04],
        'circle-blur': 1,
      }});
      map.addLayer({ id: 'sikeston-business-dots', type: 'circle', source: 'sikeston-businesses', paint: {
        'circle-radius': ['interpolate',['linear'],['get','data_confidence'], 0,3, 50,4.5, 90,6.5],
        'circle-color': '#00D1B2',
        'circle-opacity': 0.82,
        'circle-stroke-width': 1.4,
        'circle-stroke-color': '#001F1A',
        'circle-stroke-opacity': 0.85,
      }});
      map.addLayer({ id: 'sikeston-business-label', type: 'symbol', source: 'sikeston-businesses', minzoom: 13, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.6], 'text-max-width': 13, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#8FFFEA', 'text-halo-color': '#00110E', 'text-halo-width': 1.1 }});

      map.addLayer({ id: 'sikeston-event-glow', type: 'circle', source: 'sikeston-events', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 8,10, 12,18, 15,26],
        'circle-color': '#FFB020',
        'circle-opacity': ['interpolate',['linear'],['zoom'], 8,0.15, 14,0.05],
        'circle-blur': 1,
      }});
      map.addLayer({ id: 'sikeston-event-dots', type: 'circle', source: 'sikeston-events', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 8,4, 12,6, 15,8],
        'circle-color': '#FFB020',
        'circle-opacity': 0.86,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#130B00',
        'circle-stroke-opacity': 0.9,
      }});
      map.addLayer({ id: 'sikeston-event-label', type: 'symbol', source: 'sikeston-events', minzoom: 13, layout: {
        'text-field': ['get','title'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.7], 'text-max-width': 13, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#FFE1A3', 'text-halo-color': '#120900', 'text-halo-width': 1.1 }});

      map.addLayer({ id: 'power-dots', type: 'circle', source: 'federal-power', paint: {
        'circle-radius': ['match', ['get','branch'], 'white_house', 8, 'judicial', 7, 5],
        'circle-color': ['match', ['get','party'], 'Democrat', '#2F80ED', 'Republican', '#EB5757', ['match', ['get','branch'], 'white_house', '#FFD700', 'judicial', '#B388FF', '#FFFFFF']],
        'circle-opacity': 0.85, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000',
      }});
      map.addLayer({ id: 'power-label', type: 'symbol', source: 'federal-power', minzoom: 5, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.6], 'text-max-width': 12,
      }, paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#000', 'text-halo-width': 1 }});
      map.addLayer({ id: 'power-edge-glow', type: 'line', source: 'power-edges', paint: {
        'line-color': ['match', ['get','party'], 'Democrat', '#2F80ED', 'Republican', '#EB5757', '#FFFFFF'],
        'line-width': ['interpolate',['linear'],['zoom'], 1,10, 3,8, 6,4, 9,1.5],
        'line-opacity': ['interpolate',['linear'],['zoom'], 1,0.22, 4,0.18, 7,0.08, 10,0],
        'line-blur': ['interpolate',['linear'],['zoom'], 1,5, 5,3, 9,1],
      }});
      map.addLayer({ id: 'power-edge-lines', type: 'line', source: 'power-edges', paint: {
        'line-color': ['match', ['get','party'], 'Democrat', '#2F80ED', 'Republican', '#EB5757', '#FFFFFF'],
        'line-width': ['interpolate',['linear'],['zoom'], 1,4.5, 3,4, 6,2.5, 10,1.25, 14,0.8],
        'line-opacity': ['interpolate',['linear'],['zoom'], 1,0.72, 4,0.62, 8,0.42, 12,0.28],
        'line-dasharray': [2, 2],
      }});

      // Satellites
      map.addLayer({ id: 'sat-glow', type: 'circle', source: 'satellites', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,3, 5,6], 'circle-color': ['get','color'], 'circle-opacity': 0.3, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'sat-dots', type: 'circle', source: 'satellites', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,1.5, 5,3], 'circle-color': ['get','color'], 'circle-opacity': 1.0,
      }});

      // Maritime — ports & naval bases
      map.addLayer({ id: 'maritime-glow', type: 'circle', source: 'maritime', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,6, 5,12, 10,20],
        'circle-color': ['match', ['get','type'], 'naval','#FF3D3D', 'energy','#FF9500', '#00BCD4'],
        'circle-opacity': 0.1, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'maritime-dots', type: 'circle', source: 'maritime', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,3, 5,5, 10,9],
        'circle-color': ['match', ['get','type'], 'naval','#FF3D3D', 'energy','#FF9500', '#00BCD4'],
        'circle-opacity': 0.85,
        'circle-stroke-width': 2, 'circle-stroke-color': ['match', ['get','type'], 'naval','#FF3D3D', 'energy','#FF9500', '#00BCD4'], 'circle-stroke-opacity': 0.4,
      }});
      map.addLayer({ id: 'maritime-label', type: 'symbol', source: 'maritime', minzoom: 4, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.8], 'text-max-width': 12, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#00BCD4', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.7 }});

      // Maritime chokepoints — pulsing warning diamonds
      map.addLayer({ id: 'choke-glow', type: 'circle', source: 'maritime-choke', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,10, 5,18, 10,28],
        'circle-color': '#FF9500', 'circle-opacity': 0.12, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'choke-dots', type: 'circle', source: 'maritime-choke', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,4, 5,7, 10,12],
        'circle-color': ['match', ['get','risk'], 'CRITICAL','#FF1744', 'HIGH','#FF9500', 'ELEVATED','#FFD700', '#00E676'],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2, 'circle-stroke-color': '#FF9500', 'circle-stroke-opacity': 0.5,
      }});
      map.addLayer({ id: 'choke-label', type: 'symbol', source: 'maritime-choke', minzoom: 3, layout: {
        'text-field': ['get','name'], 'text-size': 10, 'text-font': ['Open Sans Bold'],
        'text-offset': [0, 2], 'text-max-width': 14, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#FF9500', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.9 }});

      // Live News — broadcast dots
      map.addLayer({ id: 'news-glow', type: 'circle', source: 'live-news', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,8, 5,14, 10,22],
        'circle-color': '#FF4081', 'circle-opacity': 0.1, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'news-dots', type: 'circle', source: 'live-news', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,4, 5,6, 10,10],
        'circle-color': '#FF4081', 'circle-opacity': 0.85,
        'circle-stroke-width': 2, 'circle-stroke-color': '#FF4081', 'circle-stroke-opacity': 0.5,
      }});
      map.addLayer({ id: 'news-label', type: 'symbol', source: 'live-news', minzoom: 4, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.8], 'text-max-width': 12, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#FF4081', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.8 }});

      // SIGINT RSS news - gold markers
      map.addLayer({ id: 'sigint-news-glow', type: 'circle', source: 'sigint-news', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,6, 5,10, 10,18],
        'circle-color': '#D4AF37', 'circle-opacity': 0.12, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'sigint-news-dots', type: 'circle', source: 'sigint-news', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,3, 5,5, 10,8],
        'circle-color': '#D4AF37', 'circle-opacity': 0.9,
        'circle-stroke-width': 1.5, 'circle-stroke-color': '#FFF8DC', 'circle-stroke-opacity': 0.6,
      }});
      map.addLayer({ id: 'sigint-news-label', type: 'symbol', source: 'sigint-news', minzoom: 5, layout: {
        'text-field': ['get','source'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.6], 'text-max-width': 10, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#D4AF37', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.85 }});

      // ══ IP SWEEP — Neighborhood device visualization ══
      map.addLayer({ id: 'sweep-connections', type: 'line', source: 'ip-sweep-connections', paint: {
        'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.3, 'line-dasharray': [2, 4],
      }});
      map.addLayer({ id: 'sweep-pulse-ring', type: 'circle', source: 'ip-sweep-pulse', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 8,40, 12,80, 16,160],
        'circle-color': 'transparent', 'circle-opacity': 0.6,
        'circle-stroke-width': 2, 'circle-stroke-color': '#FF3D3D', 'circle-stroke-opacity': 0.4,
      }});
      map.addLayer({ id: 'sweep-device-glow', type: 'circle', source: 'ip-sweep-devices', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 8,8, 12,16, 16,30],
        'circle-color': ['get', 'color'], 'circle-opacity': 0.15, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'sweep-device-dots', type: 'circle', source: 'ip-sweep-devices', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 8,3, 12,6, 16,10],
        'circle-color': ['get', 'color'], 'circle-opacity': 0.95,
        'circle-stroke-width': 1.5, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-opacity': 0.6,
      }});
      map.addLayer({ id: 'sweep-device-labels', type: 'symbol', source: 'ip-sweep-devices', minzoom: 13, layout: {
        'text-field': ['concat', ['get', 'device_type'], '\n', ['get', 'ip']],
        'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 2.2], 'text-max-width': 12, 'text-allow-overlap': false,
      }, paint: {
        'text-color': ['get', 'color'], 'text-halo-color': '#000', 'text-halo-width': 1.5, 'text-opacity': 0.9,
      }});

      // ══ SCAN TARGETS — Geolocated individual scans ══
      map.addLayer({ id: 'scan-targets-glow', type: 'circle', source: 'scan-targets', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,12, 5,25, 10,40],
        'circle-color': '#FF3D3D', 'circle-opacity': 0.2, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'scan-targets-dots', type: 'circle', source: 'scan-targets', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,5, 5,8, 10,12],
        'circle-color': '#FF3D3D', 'circle-opacity': 0.95,
        'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-opacity': 0.8,
      }});
      map.addLayer({ id: 'scan-targets-label', type: 'symbol', source: 'scan-targets', layout: {
        'text-field': ['get', 'id'], 'text-size': 11, 'text-font': ['Open Sans Bold'],
        'text-offset': [0, 2], 'text-max-width': 14, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#FF3D3D', 'text-halo-color': '#000', 'text-halo-width': 1.5, 'text-opacity': 0.9 }});

      // Flight layers (WebGL symbol — GPU rendered, handles 50K+ smooth)
      const flightLayers = [
        { id: 'fl-commercial', src: 'flights', icon: 'plane-cyan' },
        { id: 'fl-private', src: 'private-fl', icon: 'plane-green' },
        { id: 'fl-jets', src: 'jets', icon: 'plane-pink' },
        { id: 'fl-military', src: 'military', icon: 'plane-red' },
      ];
      flightLayers.forEach(l => {
        map.addLayer({ id: l.id, type: 'symbol', source: l.src, layout: {
          'icon-image': l.icon, 'icon-size': ['interpolate',['linear'],['zoom'], 1,0.4, 5,0.7, 10,1],
          'icon-rotate': ['get','heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        }, paint: { 'icon-opacity': 0.85 }});
      });

      // Balloons (moving entities)
      map.addLayer({ id: 'balloon-dots', type: 'circle', source: 'balloons', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,3, 5,5, 10,7],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.8,
        'circle-stroke-width': 1, 'circle-stroke-color': '#fff', 'circle-stroke-opacity': 0.5,
      }});
      map.addLayer({ id: 'balloon-label', type: 'symbol', source: 'balloons', minzoom: 4, layout: {
        'text-field': ['get','callsign'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.2], 'text-max-width': 12, 'text-allow-overlap': false,
      }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#000', 'text-halo-width': 1 }});

      // Radiation (glow based on reading level)
      map.addLayer({ id: 'rad-glow', type: 'circle', source: 'radiation', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,10, 5,20, 10,40],
        'circle-color': ['match', ['get','status'], 'DANGER','#FF1744', 'WARNING','#FF9500', '#AB47BC'],
        'circle-opacity': 0.15, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'rad-dots', type: 'circle', source: 'radiation', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,4, 5,6, 10,8],
        'circle-color': ['match', ['get','status'], 'DANGER','#FF1744', 'WARNING','#FF9500', '#AB47BC'],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2, 'circle-stroke-color': ['match', ['get','status'], 'DANGER','#FF1744', 'WARNING','#FF9500', '#AB47BC'], 'circle-stroke-opacity': 0.4,
      }});
      map.addLayer({ id: 'rad-label', type: 'symbol', source: 'radiation', minzoom: 5, layout: {
        'text-field': ['concat', ['to-string', ['get','reading']], ' nSv/h'], 'text-size': 9, 'text-font': ['Open Sans Bold'],
        'text-offset': [0, 1.5], 'text-allow-overlap': false,
      }, paint: { 'text-color': ['match', ['get','status'], 'DANGER','#FF1744', 'WARNING','#FF9500', '#AB47BC'], 'text-halo-color': '#000', 'text-halo-width': 1 }});

      // Maritime Ships (moving entities)
      map.addLayer({ id: 'ship-dots', type: 'circle', source: 'maritime-ships', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,2, 5,4, 10,6],
        'circle-color': ['match', ['get','type'], 'military','#FF1744', 'tanker','#FF9500', 'cargo','#00BCD4', '#fff'],
        'circle-opacity': 0.8,
      }});
      map.addLayer({ id: 'ship-label', type: 'symbol', source: 'maritime-ships', minzoom: 5, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.2], 'text-allow-overlap': false,
      }, paint: { 'text-color': ['match', ['get','type'], 'military','#FF1744', 'tanker','#FF9500', 'cargo','#00BCD4', '#fff'], 'text-halo-color': '#000', 'text-halo-width': 1 }});

      setMapReady(true);
    });

    // Events
    let lastMove = 0;
    map.on('mousemove', e => {
      const now = Date.now();
      if (now - lastMove > 100) {
        lastMove = now;
        onMouseCoords?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      }
    });
    map.on('contextmenu', e => { e.preventDefault(); onRightClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    map.on('moveend', () => { const c = map.getCenter(); onViewStateChange?.({ zoom: map.getZoom(), latitude: c.lat }); });

    // ── POPUP HELPER ──
    const popup = (coords: any, html: string) => {
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '420px', offset: 14 }).setLngLat(coords).setHTML(html).addTo(map);
    };
    const pStyle = `background:rgba(12,14,26,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'JetBrains Mono',monospace;`;
    const linkStyle = `display:inline-block;margin-top:8px;padding:5px 12px;font-size:10px;letter-spacing:0.12em;text-decoration:none;border-radius:5px;font-family:'JetBrains Mono',monospace;`;

    // ── Flights (with FlightAware + ADS-B Exchange links) ──
    ['fl-commercial','fl-private','fl-jets','fl-military'].forEach(layer => {
      map.on('click', layer, e => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as any;
        const coords = (e.features[0].geometry as any).coordinates;
        const cs = (p.callsign||'').trim();
        popup(coords, `<div style="${pStyle}border:1px solid rgba(212,175,55,0.3);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="color:#D4AF37;font-size:16px;font-weight:700;letter-spacing:0.1em;">${cs}</span>
            <span style="color:#5C5A54;font-size:10px;">${p.icao24||''}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px;">
            <div><span style="color:#5C5A54;font-size:9px;">MODEL</span><br/><span style="color:#E8E6E0;">${p.model||'—'}</span></div>
            <div><span style="color:#5C5A54;font-size:9px;">ALT</span><br/><span style="color:#00E5FF;">${p.alt?Math.round(p.alt)+'m':'—'}</span></div>
            <div><span style="color:#5C5A54;font-size:9px;">SPEED</span><br/><span style="color:#E8E6E0;">${p.speed_knots||'—'}kt</span></div>
            <div><span style="color:#5C5A54;font-size:9px;">HDG</span><br/><span style="color:#E8E6E0;">${Math.round(p.heading||0)}°</span></div>
            <div><span style="color:#5C5A54;font-size:9px;">REG</span><br/><span style="color:#E8E6E0;">${p.registration||'—'}</span></div>
            <div><span style="color:#5C5A54;font-size:9px;">POS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(2)},${coords[0].toFixed(2)}</span></div>
          </div>
          <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">
            <a href="https://www.flightaware.com/live/flight/${cs}" target="_blank" style="${linkStyle}color:#D4AF37;border:1px solid rgba(212,175,55,0.4);background:rgba(212,175,55,0.1);">⚡ FLIGHTAWARE</a>
            <a href="https://globe.adsbexchange.com/?icao=${p.icao24||''}" target="_blank" style="${linkStyle}color:#00E5FF;border:1px solid rgba(0,229,255,0.4);background:rgba(0,229,255,0.1);">📡 ADS-B</a>
            <a href="https://www.radarbox.com/data/flights/${cs}" target="_blank" style="${linkStyle}color:#FF69B4;border:1px solid rgba(255,105,180,0.4);background:rgba(255,105,180,0.1);">📍 RADARBOX</a>
          </div>
        </div>`);
        onEntityClick?.(p);
      });
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });

    // ── CCTV (opens CameraViewer panel) ──
    map.on('click', 'cctv-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      // Emit the camera data so the CameraViewer opens
      onEntityClick?.({
        type: 'cctv',
        id: p.id,
        name: p.name,
        city: p.city,
        country: p.country,
        source: p.source,
        feed_url: p.feed_url,
        stream_url: p.stream_url,
        stream_type: p.stream_type,
        external_url: p.external_url,
        lat: coords[1],
        lng: coords[0],
      });
      // Also fly to the camera
      map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 13), duration: 1000 });
    });

    // ── Earthquakes (with USGS link) ──
    map.on('click', 'eq-circles', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      popup(coords, `<div style="${pStyle}border:1px solid rgba(255,149,0,0.3);">
        <div style="color:#FF9500;font-size:14px;font-weight:700;margin-bottom:4px;">M${p.magnitude} EARTHQUAKE</div>
        <div style="font-size:9px;color:#E8E6E0;margin-bottom:8px;">${p.place||'Unknown location'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;">
          <div><span style="color:#5C5A54;">DEPTH</span><br/><span style="color:#E8E6E0;">${p.depth||'—'}km</span></div>
          <div><span style="color:#5C5A54;">COORDS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(3)}, ${coords[0].toFixed(3)}</span></div>
        </div>
        <a href="${p.source === 'NIGGG-BAS' ? 'https://ndc.niggg.bas.bg/' : `https://earthquake.usgs.gov/earthquakes/eventpage/${p.id||''}`}" target="_blank" style="${linkStyle}color:#FF9500;border:1px solid rgba(255,149,0,0.4);background:rgba(255,149,0,0.1);">📊 ${p.source === 'NIGGG-BAS' ? 'NIGGG-BAS' : 'USGS DETAILS'}</a>
      </div>`);
    });

    // ── Satellites (SatNOGS powered) ──
    map.on('click', 'sat-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      popup(coords, `<div style="${pStyle}border:1px solid rgba(212,175,55,0.3);">
        <div style="color:#D4AF37;font-size:12px;font-weight:700;letter-spacing:0.1em;margin-bottom:4px;">🛰️ ${p.name}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px;margin-bottom:8px;">
          <div><span style="color:#5C5A54;">MISSION</span><br/><span style="color:${p.color||'#aaa'};">${p.mission||'Unknown'}</span></div>
          <div><span style="color:#5C5A54;">ALT</span><br/><span style="color:#00E5FF;">${p.alt ? p.alt+' km' : '—'}</span></div>
          <div><span style="color:#5C5A54;">POS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(2)}°, ${coords[0].toFixed(2)}°</span></div>
        </div>
        ${p.noradId ? `<a href="https://db.satnogs.org/satellite/${p.noradId}/" target="_blank" style="display:block;text-align:center;padding:4px;margin-top:6px;font-size:8px;font-family:monospace;letter-spacing:0.1em;text-decoration:none;color:#00E5FF;border:1px solid rgba(0,229,255,0.4);background:rgba(0,229,255,0.1);border-radius:2px;cursor:pointer;">🔭 SOURCE: SATNOGS</a>` : ''}
      </div>`);
    });

    // ── Fires (with NASA FIRMS link) ──
    map.on('click', 'fires-heat', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      popup(coords, `<div style="${pStyle}border:1px solid rgba(255,107,0,0.3);">
        <div style="color:#FF6B00;font-size:12px;font-weight:700;margin-bottom:6px;">🔥 ACTIVE FIRE DETECTED</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;margin-bottom:8px;">
          <div><span style="color:#5C5A54;">BRIGHTNESS</span><br/><span style="color:#FF6B00;">${p.brightness||'—'}K</span></div>
          <div><span style="color:#5C5A54;">COORDS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(3)}°, ${coords[0].toFixed(3)}°</span></div>
        </div>
        <a href="https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;l:noaa20-viirs,viirs,modis_a,modis_t;@${coords[0]},${coords[1]},10z" target="_blank" style="${linkStyle}color:#FF6B00;border:1px solid rgba(255,107,0,0.4);background:rgba(255,107,0,0.1);">🛰️ NASA FIRMS MAP</a>
      </div>`);
    });

    // ── GDELT Conflicts (with source article) ──
    map.on('click', 'gdelt-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      popup(coords, `<div style="${pStyle}border:1px solid rgba(255,61,61,0.3);">
        <div style="color:#FF3D3D;font-size:12px;font-weight:700;margin-bottom:6px;">⚠️ CONFLICT EVENT</div>
        <div style="font-size:9px;color:#E8E6E0;margin-bottom:8px;line-height:1.4;">${p.name||'Unclassified incident'}</div>
        <div style="display:flex;gap:6px;">
          ${p.url ? `<a href="${p.url}" target="_blank" style="${linkStyle}color:#FF3D3D;border:1px solid rgba(255,61,61,0.4);background:rgba(255,61,61,0.1);">SOURCE</a>` : ''}
          <a href="https://www.google.com/maps/@${coords[1]},${coords[0]},12z" target="_blank" style="${linkStyle}color:#448AFF;border:1px solid rgba(68,138,255,0.4);background:rgba(68,138,255,0.1);">MAP</a>
        </div>
      </div>`);
    });

    // ── Global Event / Conflict Markers ──
    map.on('click', 'conflict-icons', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      const color = p.severity === 'war' ? '#FF1744' : p.severity === 'high' ? '#FF9500' : '#FFD500';
      popup(coords, `<div style="${pStyle}border:1px solid ${color}40;">
        <div style="color:${color};font-size:12px;font-weight:700;margin-bottom:6px;">⚠️ ${p.label || 'WARNING EVENT'}</div>
        <div style="font-size:10px;color:#E8E6E0;margin-bottom:8px;line-height:1.4;">${p.description || 'Global event detected at this location.'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;margin-bottom:8px;">
          <div><span style="color:#5C5A54;">SEVERITY</span><br/><span style="color:${color};">${(p.severity||'unknown').toUpperCase()}</span></div>
          <div><span style="color:#5C5A54;">COORDS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(3)}°, ${coords[0].toFixed(3)}°</span></div>
        </div>
      </div>`);
    });


    // ── Generic hover for clickables ──
    ['conflict-icons','cctv-dots','eq-circles','sat-dots','fires-heat','gdelt-dots','weather-dots','infra-dots','maritime-dots','choke-dots','news-dots','sigint-news-dots','balloon-dots','rad-dots','ship-dots','sweep-device-dots','scan-targets-dots'].forEach(layer => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });

    // ── Scan Targets click ──
    map.on('click', 'scan-targets-dots', (e: any) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const coords = e.features[0].geometry.coordinates.slice();
      popup(coords, `<div style="${pStyle}border:1px solid rgba(255,61,61,0.5);">
        <div style="color:#FF3D3D;font-size:12px;font-weight:700;margin-bottom:6px;">🎯 TARGET: ${p.id}</div>
        <div style="font-size:9px;color:#E8E6E0;margin-bottom:8px;">${p.city || 'Unknown'}, ${p.country || 'Unknown'} — ${p.isp || 'Unknown ISP'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;">
          <div><span style="color:#5C5A54;">TYPE</span><br/><span style="color:#00E5FF;">${(p.type || 'UNKNOWN').toUpperCase()}</span></div>
          <div><span style="color:#5C5A54;">COORDS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(3)}°, ${coords[0].toFixed(3)}°</span></div>
        </div>
      </div>`);
    });

    // ── IP Sweep device click ──
    map.on('click', 'sweep-device-dots', (e: any) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const coords = e.features[0].geometry.coordinates.slice();
      const ports = JSON.parse(p.ports || '[]');
      const vulns = JSON.parse(p.vulns || '[]');
      const hostnames = JSON.parse(p.hostnames || '[]');
      const riskColors: Record<string, string> = { CRITICAL: '#FF3D3D', HIGH: '#FF6B00', MEDIUM: '#FFD700', LOW: '#76FF03', INFO: '#5C5A54' };
      popup(coords, `<div style="font-family:monospace;font-size:11px;color:#E8E6E0;">
        <div style="font-size:13px;font-weight:bold;margin-bottom:6px;color:${p.color};">${p.device_type}</div>
        <div style="font-size:12px;margin-bottom:8px;color:#fff;">${p.ip}</div>
        ${hostnames.length > 0 ? `<div style="font-size:9px;color:#8A8880;margin-bottom:6px;">${hostnames.join(', ')}</div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
          <div><span style="color:#5C5A54;">PORTS</span><br/><span style="color:#E8E6E0;">${ports.length}</span></div>
          <div><span style="color:#5C5A54;">RISK</span><br/><span style="color:${riskColors[p.risk_level] || '#666'};">${p.risk_level}</span></div>
        </div>
        <div style="font-size:9px;color:#8A8880;margin-bottom:6px;">Open: ${ports.slice(0, 12).join(', ')}${ports.length > 12 ? ' ...' : ''}</div>
        ${vulns.length > 0 ? `<div style="font-size:9px;color:#FF3D3D;margin-bottom:6px;">⚠ CVEs: ${vulns.slice(0, 5).join(', ')}${vulns.length > 5 ? ` +${vulns.length - 5} more` : ''}</div>` : ''}
      </div>`);
    });

    // ── Balloons / Sondes ──
    map.on('click', 'balloon-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      popup(coords, `<div style="${pStyle}border:1px solid ${p.color}40;">
        <div style="color:${p.color};font-size:12px;font-weight:700;letter-spacing:0.1em;margin-bottom:4px;">🎈 ${p.callsign}</div>
        <div style="font-size:9px;color:#aaa;margin-bottom:8px;">${p.type.toUpperCase()} / STATUS: ${p.status.toUpperCase()}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;">
          <div><span style="color:#5C5A54;">ALTITUDE</span><br/><span style="color:#E8E6E0;">${p.altitude} m</span></div>
          <div><span style="color:#5C5A54;">SPEED</span><br/><span style="color:#E8E6E0;">${Math.round(p.speed)} km/h</span></div>
          <div><span style="color:#5C5A54;">VERT RATE</span><br/><span style="color:${p.verticalRate > 0 ? '#00E676' : '#FF3D3D'};">${p.verticalRate.toFixed(1)} m/s</span></div>
          <div><span style="color:#5C5A54;">TEMP</span><br/><span style="color:#E8E6E0;">${p.temperature}°C</span></div>
        </div>
      </div>`);
    });

    // ── Radiation ──
    map.on('click', 'rad-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      const color = p.status === 'DANGER' ? '#FF1744' : p.status === 'WARNING' ? '#FF9500' : '#AB47BC';
      popup(coords, `<div style="${pStyle}border:1px solid ${color}40;">
        <div style="color:${color};font-size:12px;font-weight:700;margin-bottom:4px;">☢️ ${p.name}</div>
        <div style="font-size:9px;color:#aaa;margin-bottom:8px;">${p.city}, ${p.country}</div>
        <div style="display:grid;grid-template-columns:1fr;gap:4px;font-size:11px;">
          <div><span style="color:#5C5A54;font-size:9px;">READING</span><br/><span style="color:${color};font-weight:bold;">${p.reading} nSv/h</span></div>
          <div><span style="color:#5C5A54;font-size:9px;">STATUS</span><br/><span style="color:${color};">${p.status}</span></div>
          <div><span style="color:#5C5A54;font-size:9px;">NETWORK</span><br/><span style="color:#E8E6E0;">${p.network}</span></div>
        </div>
      </div>`);
    });

    // ── Maritime Ships ──
    map.on('click', 'ship-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      const color = p.type === 'military' ? '#FF1744' : p.type === 'tanker' ? '#FF9500' : '#00BCD4';
      popup(coords, `<div style="${pStyle}border:1px solid ${color}40;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="color:${color};font-size:12px;font-weight:700;letter-spacing:0.1em;">🚢 ${p.name}</span>
          <span style="color:#aaa;font-size:9px;">${p.flag}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;">
          <div><span style="color:#5C5A54;">TYPE</span><br/><span style="color:${color};">${p.type.toUpperCase()}</span></div>
          <div><span style="color:#5C5A54;">SPEED</span><br/><span style="color:#E8E6E0;">${p.speed} knots</span></div>
          <div><span style="color:#5C5A54;">HEADING</span><br/><span style="color:#E8E6E0;">${p.heading}°</span></div>
          <div><span style="color:#5C5A54;">DEST</span><br/><span style="color:#E8E6E0;">${p.destination || 'UNKNOWN'}</span></div>
        </div>
      </div>`);
    });

    // ── Weather Events (NASA EONET) ──
    map.on('click', 'weather-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      const iconEmoji = p.icon === 'cyclone' ? '🌀' : p.icon === 'volcano' ? '🌋' : '⚡';
      popup(coords, `<div style="${pStyle}border:1px solid rgba(224,64,251,0.3);">
        <div style="color:#E040FB;font-size:14px;font-weight:700;margin-bottom:6px;">${iconEmoji} ${p.type || 'Weather Event'}</div>
        <div style="font-size:10px;color:#E8E6E0;margin-bottom:8px;line-height:1.4;">${p.title || 'Unknown event'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;margin-bottom:8px;">
          <div><span style="color:#5C5A54;">SEVERITY</span><br/><span style="color:${p.severity === 'high' ? '#FF1744' : '#FFD700'};">${(p.severity||'low').toUpperCase()}</span></div>
          <div><span style="color:#5C5A54;">COORDS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(3)}°, ${coords[0].toFixed(3)}°</span></div>
        </div>
        <div style="display:flex;gap:6px;">
          ${p.source ? `<a href="${p.source}" target="_blank" style="${linkStyle}color:#E040FB;border:1px solid rgba(224,64,251,0.4);background:rgba(224,64,251,0.1);">📡 SOURCE</a>` : ''}
          <a href="https://eonet.gsfc.nasa.gov/api/v3/events/${p.id || ''}" target="_blank" style="${linkStyle}color:#D4AF37;border:1px solid rgba(212,175,55,0.4);background:rgba(212,175,55,0.1);">🛰️ NASA EONET</a>
        </div>
      </div>`);
    });

    // ── Nuclear Infrastructure ──
    map.on('click', 'infra-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      const statusColor = p.status === 'Active Conflict Zone' ? '#FF1744' : p.status === 'Operational' ? '#76FF03' : '#757575';
      popup(coords, `<div style="${pStyle}border:1px solid rgba(118,255,3,0.3);">
        <div style="color:#76FF03;font-size:14px;font-weight:700;margin-bottom:4px;">☢️ ${p.name || 'Nuclear Facility'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px;margin-bottom:8px;">
          <div><span style="color:#5C5A54;">STATUS</span><br/><span style="color:${statusColor};">${p.status || '—'}</span></div>
          <div><span style="color:#5C5A54;">CITY</span><br/><span style="color:#E8E6E0;">${p.city || '—'}, ${p.country || ''}</span></div>
          <div><span style="color:#5C5A54;">REACTORS</span><br/><span style="color:#76FF03;">${p.reactors || '—'}</span></div>
          <div><span style="color:#5C5A54;">CAPACITY</span><br/><span style="color:#E8E6E0;">${p.capacityMW ? p.capacityMW.toLocaleString() + ' MW' : '—'}</span></div>
          <div><span style="color:#5C5A54;">OWNER</span><br/><span style="color:#E8E6E0;">${p.owner || '—'}</span></div>
          <div><span style="color:#5C5A54;">COORDS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(3)}°, ${coords[0].toFixed(3)}°</span></div>
        </div>
        <a href="https://www.google.com/maps/@${coords[1]},${coords[0]},14z/data=!3m1!1e3" target="_blank" style="${linkStyle}color:#76FF03;border:1px solid rgba(118,255,3,0.4);background:rgba(118,255,3,0.1);">SATELLITE VIEW</a>
      </div>`);
    });

    // ── Maritime Ports & Naval Bases ──
    map.on('click', 'maritime-dots', e => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const coords = (e.features![0].geometry as any).coordinates;
      const typeColor = p.type === 'naval' ? '#FF3D3D' : p.type === 'energy' ? '#FF9500' : '#00BCD4';
      const typeLabel = p.type === 'naval' ? 'NAVAL BASE' : p.type === 'energy' ? 'ENERGY PORT' : 'CONTAINER PORT';
      popup(coords, `<div style="${pStyle}border:1px solid ${typeColor}40;">
        <div style="color:${typeColor};font-weight:bold;font-size:11px;margin-bottom:4px;">${p.name}</div>
        <div style="color:#999;font-size:9px;margin-bottom:6px;">${typeLabel} — ${p.country}</div>
        ${p.volume ? `<div style="font-size:9px;color:#aaa;">Volume: <span style="color:${typeColor};font-weight:bold;">${p.volume}</span></div>` : ''}
        ${p.fleet ? `<div style="font-size:9px;color:#aaa;">Fleet: <span style="color:${typeColor};font-weight:bold;">${p.fleet}</span></div>` : ''}
        ${p.rank ? `<div style="font-size:9px;color:#aaa;">Global Rank: <span style="color:${typeColor};font-weight:bold;">#${p.rank}</span></div>` : ''}
      </div>`);
    });

    // ── Maritime Chokepoints ──
    map.on('click', 'choke-dots', e => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const coords = (e.features![0].geometry as any).coordinates;
      const riskCol = p.risk === 'CRITICAL' ? '#FF1744' : p.risk === 'HIGH' ? '#FF9500' : p.risk === 'ELEVATED' ? '#FFD700' : '#00E676';
      popup(coords, `<div style="${pStyle}border:1px solid ${riskCol}40;">
        <div style="color:#FF9500;font-weight:bold;font-size:11px;margin-bottom:4px;">${p.name}</div>
        <div style="font-size:9px;color:#aaa;">Traffic: <span style="color:#fff;">${p.traffic}</span></div>
        <div style="font-size:9px;color:#aaa;">Risk: <span style="color:${riskCol};font-weight:bold;">${p.risk}</span></div>
      </div>`);
    });

    // ── Live News (opens feed viewer) ──
    map.on('click', 'news-dots', e => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      onEntityClick?.({
        type: 'live_news',
        name: p.name,
        city: p.city,
        country: p.country,
        url: p.url,
        category: p.category,
        embed_allowed: p.embed_allowed !== false && p.embed_allowed !== 'false',
      });
    });

    map.on('click', 'hud-pha-bubbles', e => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      onEntityClick?.({ ...p, type: 'hud_pha' });
    });

    map.on('click', 'sbir-recipient-dots', e => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      onEntityClick?.({ ...p, type: 'sbir_recipient' });
    });

    [
      ['education-org-dots', 'education_org'],
      ['workforce-org-dots', 'workforce_org'],
      ['health-org-dots', 'health_org'],
      ['funded-faith-org-dots', 'funded_faith_org'],
    ].forEach(([layer, type]) => {
      map.on('click', layer, e => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        onEntityClick?.({ ...p, type });
      });
    });

    map.on('click', 'sikeston-business-dots', e => {
      const p = e.features?.[0]?.properties as any;
      if (!p) return;
      const coords = (e.features![0].geometry as any).coordinates;
      const categories = (() => {
        try { return JSON.parse(p.categories || '[]').join(', '); } catch { return p.categories || ''; }
      })();
      popup(coords, `<div style="${pStyle}border:1px solid rgba(0,209,178,0.35);">
        <div style="color:#8FFFEA;font-size:13px;font-weight:700;margin-bottom:5px;">${p.name || 'Sikeston Business'}</div>
        <div style="font-size:10px;color:#E8E6E0;line-height:1.45;">${[p.address, p.city, p.state, p.zip].filter(Boolean).join(', ') || 'Address not listed'}</div>
        ${categories ? `<div style="margin-top:6px;font-size:9px;color:#00D1B2;">${categories}</div>` : ''}
        ${p.phone ? `<div style="margin-top:6px;font-size:9px;color:#aaa;">${p.phone}</div>` : ''}
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          ${p.website ? `<a href="${p.website}" target="_blank" style="${linkStyle}color:#00D1B2;border:1px solid rgba(0,209,178,0.4);background:rgba(0,209,178,0.1);">WEBSITE</a>` : ''}
          <a href="${p.source_url}" target="_blank" style="${linkStyle}color:#8FFFEA;border:1px solid rgba(143,255,234,0.4);background:rgba(143,255,234,0.1);">CHAMBER</a>
        </div>
      </div>`);
    });

    map.on('click', 'sikeston-event-dots', e => {
      const p = e.features?.[0]?.properties as any;
      if (!p) return;
      const coords = (e.features![0].geometry as any).coordinates;
      const when = p.startDate ? new Date(p.startDate) : null;
      const dateText = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : (p.date_label || 'Date TBD');
      const timeText = when && !Number.isNaN(when.getTime()) ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : (p.time_label || '');
      popup(coords, `<div style="${pStyle}border:1px solid rgba(255,176,32,0.35);">
        <div style="color:#FFE1A3;font-size:13px;font-weight:700;margin-bottom:5px;">${p.title || 'Sikeston Event'}</div>
        <div style="display:grid;grid-template-columns:70px 1fr;gap:4px;font-size:10px;margin-bottom:8px;">
          <span style="color:#5C5A54;">WHEN</span><span style="color:#FFB020;">${dateText} ${timeText}</span>
          <span style="color:#5C5A54;">WHERE</span><span style="color:#E8E6E0;">${p.location || 'Location TBD'}</span>
        </div>
        ${p.description ? `<div style="font-size:9px;color:#aaa;line-height:1.4;">${String(p.description).slice(0, 220)}</div>` : ''}
        <a href="${p.source_url}" target="_blank" style="${linkStyle}color:#FFB020;border:1px solid rgba(255,176,32,0.4);background:rgba(255,176,32,0.1);">EVENT DETAILS</a>
      </div>`);
    });

    map.on('click', 'power-dots', e => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      onEntityClick?.({ ...p, type: 'federal_power' });
    });

    ['hud-pha-bubbles', 'sbir-recipient-dots', 'education-org-dots', 'workforce-org-dots', 'health-org-dots', 'funded-faith-org-dots', 'sikeston-business-dots', 'sikeston-event-dots', 'power-dots'].forEach(layer => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Day/Night
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const update = () => {
      const src = map.getSource('day-night') as any;
      if (!src) return;
      if (!activeLayers.day_night) { src.setData(EMPTY_FC); return; }
      src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [computeSolarTerminator()] }, properties: {} }] });
    };
    update();
    const iv = setInterval(update, 300000); // 5 min (was 1 min — shadow barely moves)
    return () => clearInterval(iv);
  }, [mapReady, activeLayers.day_night]);

  // Helper to set GeoJSON
  const setGeo = useCallback((source: string, features: any[]) => {
    const src = mapRef.current?.getSource(source) as any;
    if (src) src.setData({ type: 'FeatureCollection', features });
  }, []);

  const setVis = useCallback((ids: string[], visible: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    ids.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'); });
  }, []);

  // Flight data → GeoJSON (GPU rendered)
  useEffect(() => {
    if (!mapReady) return;
    const toFeatures = (arr: any[]) => (arr || []).map((f: any) => ({
      type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] },
      properties: { callsign: f.callsign, heading: f.heading || 0, alt: f.alt, model: f.model, speed_knots: f.speed_knots, registration: f.registration, icao24: f.icao24 },
    }));
    setGeo('flights', activeLayers.flights ? toFeatures(data.commercial_flights) : []);
    setGeo('private-fl', activeLayers.private ? toFeatures(data.private_flights) : []);
    setGeo('jets', activeLayers.jets ? toFeatures(data.private_jets) : []);
    setGeo('military', activeLayers.military ? toFeatures(data.military_flights) : []);
  }, [mapReady, data.commercial_flights, data.private_flights, data.private_jets, data.military_flights, activeLayers.flights, activeLayers.private, activeLayers.jets, activeLayers.military]);

  // ── DECOUPLED LAYER RENDERERS (Performance Optimized) ──

  useEffect(() => {
    if (!mapReady) return;
    setGeo('earthquakes', activeLayers.earthquakes && data.earthquakes ? data.earthquakes.map((eq: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [eq.lng, eq.lat] }, properties: { magnitude: eq.magnitude, place: eq.place } })) : []);
  }, [mapReady, data.earthquakes, activeLayers.earthquakes, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('satellites', activeLayers.satellites && data.satellites ? data.satellites.map((s: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: { name: s.name, color: s.color, mission: s.mission, alt: s.alt, noradId: s.noradId } })) : []);
  }, [mapReady, data.satellites, activeLayers.satellites, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('gdelt', activeLayers.global_incidents && data.gdelt ? data.gdelt.map((e: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lng, e.lat] }, properties: { name: e.name } })) : []);
  }, [mapReady, data.gdelt, activeLayers.global_incidents, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('gps-jamming', activeLayers.gps_jamming && data.gps_jamming ? data.gps_jamming.map((z: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [z.lng, z.lat] }, properties: { severity: z.severity } })) : []);
  }, [mapReady, data.gps_jamming, activeLayers.gps_jamming, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('cctv', activeLayers.cctv && data.cameras ? data.cameras.map((c: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { id: c.id, name: c.name, city: c.city, country: c.country, source: c.source, feed_url: c.feed_url, stream_url: c.stream_url, stream_type: c.stream_type, external_url: c.external_url } })) : []);
  }, [mapReady, data.cameras, activeLayers.cctv, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('fires', activeLayers.fires && data.fires ? data.fires.map((f: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] }, properties: { brightness: f.brightness } })) : []);
  }, [mapReady, data.fires, activeLayers.fires, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('weather', activeLayers.weather && data.weather_events ? data.weather_events.map((w: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [w.lng, w.lat] }, properties: { title: w.title, type: w.type, icon: w.icon, severity: w.severity, source: w.source, id: w.id } })) : []);
  }, [mapReady, data.weather_events, activeLayers.weather, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('infrastructure', activeLayers.infrastructure && data.infrastructure ? data.infrastructure.map((i: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i.lng, i.lat] }, properties: { name: i.name, city: i.city, country: i.country, status: i.status, reactors: i.reactors, capacityMW: i.capacityMW, owner: i.owner } })) : []);
  }, [mapReady, data.infrastructure, activeLayers.infrastructure, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    const phas = Array.isArray(data.hud_phas) ? data.hud_phas : [];
    setGeo('hud-pha-flows', activeLayers.hud_pha_flows ? phas
      .filter((p: any) => Number.isFinite(Number(p.lng)) && Number.isFinite(Number(p.lat)))
      .map((p: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(p.lng), Number(p.lat)] },
        properties: {
          ...p,
          annual_hud_funding: p.funding_profile?.annual_hud_funding,
          funding_per_unit: p.funding_profile?.funding_per_unit,
          section8_ratio: p.funding_profile?.section8_ratio,
          pha_opportunity_score: p.funding_profile?.opportunity_score,
          sbir_awards_10mi: p.ecosystem_summary?.sbir_awards_10mi,
          sbir_awards_25mi: p.ecosystem_summary?.sbir_awards_25mi,
          sbir_awards_50mi: p.ecosystem_summary?.sbir_awards_50mi,
          unique_sbir_companies_10mi: p.ecosystem_summary?.unique_sbir_companies_10mi,
          unique_sbir_companies_25mi: p.ecosystem_summary?.unique_sbir_companies_25mi,
          unique_sbir_companies_50mi: p.ecosystem_summary?.unique_sbir_companies_50mi,
          total_federal_investment_25mi: p.ecosystem_summary?.total_federal_investment_25mi,
          ecosystem_last_updated: p.ecosystem_summary?.last_updated,
          type: 'hud_pha'
        }
      })) : []);
  }, [mapReady, data.hud_phas, activeLayers.hud_pha_flows, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    const recipients = Array.isArray(data.sbir_recipients) ? data.sbir_recipients : [];
    setGeo('sbir-recipients', activeLayers.sbir_recipients ? recipients
      .filter((r: any) => Number.isFinite(Number(r.lng)) && Number.isFinite(Number(r.lat)))
      .map((r: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] }, properties: { ...r, type: 'sbir_recipient' } })) : []);
  }, [mapReady, data.sbir_recipients, activeLayers.sbir_recipients, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    const spreadStackedPoints = (items: any[], shouldSpread = false) => {
      const plottable = (Array.isArray(items) ? items : [])
        .filter((item: any) => Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat)));
      if (!shouldSpread) return plottable.map((item: any) => ({ item, lat: Number(item.lat), lng: Number(item.lng), stack_count: 1, stack_index: 0 }));

      const stacks = new Map<string, any[]>();
      plottable.forEach((item: any) => {
        const key = `${Number(item.lat).toFixed(4)},${Number(item.lng).toFixed(4)}`;
        stacks.set(key, [...(stacks.get(key) || []), item]);
      });

      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      return plottable.map((item: any) => {
        const key = `${Number(item.lat).toFixed(4)},${Number(item.lng).toFixed(4)}`;
        const stack = stacks.get(key) || [item];
        const stack_index = stack.findIndex((candidate: any) => (candidate.id || candidate.name) === (item.id || item.name));
        const safeIndex = Math.max(0, stack_index);
        if (stack.length === 1) return { item, lat: Number(item.lat), lng: Number(item.lng), stack_count: 1, stack_index: 0 };

        const angle = safeIndex * goldenAngle;
        const radius = Math.min(0.9, 0.035 * Math.sqrt(safeIndex + 1));
        return {
          item,
          lat: Number(item.lat) + Math.sin(angle) * radius,
          lng: Number(item.lng) + Math.cos(angle) * radius,
          stack_count: stack.length,
          stack_index: safeIndex,
        };
      });
    };
    const toCapabilityFeatures = (items: any[], type: string, shouldSpread = false) => spreadStackedPoints(items, shouldSpread)
      .map(({ item, lat, lng, stack_count, stack_index }: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          ...item,
          type,
          display_lat: lat,
          display_lng: lng,
          stack_count,
          stack_index,
          node_weight: Number(item.student_size || item.award_count || item.total_obligations || item.data_confidence || 1),
        },
      }));
    setGeo('education-orgs', activeLayers.education_orgs ? toCapabilityFeatures(data.education_orgs, 'education_org') : []);
    setGeo('workforce-orgs', activeLayers.workforce_orgs ? toCapabilityFeatures(data.workforce_orgs, 'workforce_org', true) : []);
    setGeo('health-orgs', activeLayers.health_orgs ? toCapabilityFeatures(data.health_orgs, 'health_org') : []);
    setGeo('funded-faith-orgs', activeLayers.funded_faith_orgs ? toCapabilityFeatures(data.funded_faith_orgs, 'funded_faith_org') : []);
  }, [mapReady, data.education_orgs, data.workforce_orgs, data.health_orgs, data.funded_faith_orgs, activeLayers.education_orgs, activeLayers.workforce_orgs, activeLayers.health_orgs, activeLayers.funded_faith_orgs, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('sikeston-businesses', activeLayers.sikeston_businesses && data.sikeston_businesses ? data.sikeston_businesses
      .filter((b: any) => Number.isFinite(Number(b.lng)) && Number.isFinite(Number(b.lat)))
      .map((b: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(b.lng), Number(b.lat)] }, properties: { ...b, categories: JSON.stringify(b.categories || []) } })) : []);
  }, [mapReady, data.sikeston_businesses, activeLayers.sikeston_businesses, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('sikeston-events', activeLayers.sikeston_events && data.sikeston_events ? data.sikeston_events
      .filter((event: any) => Number.isFinite(Number(event.lng)) && Number.isFinite(Number(event.lat)))
      .map((event: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(event.lng), Number(event.lat)] }, properties: event })) : []);
  }, [mapReady, data.sikeston_events, activeLayers.sikeston_events, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    const showPower = (p: any) => {
      if (activeLayers.federal_power) return true;
      if (p.branch === 'congress' && p.chamber === 'House') return !!activeLayers.federal_power_house;
      if (p.branch === 'congress' && p.chamber === 'Senate') return !!activeLayers.federal_power_senate;
      if (p.branch === 'judicial') return !!activeLayers.federal_power_judicial;
      if (p.branch === 'white_house') return !!activeLayers.federal_power_white_house;
      return false;
    };
    setGeo('federal-power', data.federal_power ? data.federal_power.filter(showPower).map((p: any, index: number) => {
      const offset = (index % 9) * 0.08;
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [(p.lng || -77.0369) + offset, (p.lat || 38.9072) + offset] }, properties: { ...p, type: 'federal_power' } };
    }) : []);
  }, [mapReady, data.federal_power, activeLayers.federal_power, activeLayers.federal_power_house, activeLayers.federal_power_senate, activeLayers.federal_power_judicial, activeLayers.federal_power_white_house, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    if (!activeLayers.power_edges || (!activeLayers.power_edges_democrat && !activeLayers.power_edges_republican) || !data.federal_power?.length) {
      setGeo('power-edges', []);
      return;
    }
    const dc: [number, number] = [-77.0369, 38.9072];
    const dist = (a: [number, number], b: [number, number]) => {
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      return dx * dx + dy * dy;
    };
    const makeLoop = (party: string) => {
      const seen = new Set<string>();
      const points = (data.federal_power || [])
        .filter((p: any) => p.branch === 'congress' && p.party === party && typeof p.lng === 'number' && typeof p.lat === 'number')
        .filter((p: any) => (p.chamber === 'House' && activeLayers.federal_power_house !== false) || (p.chamber === 'Senate' && activeLayers.federal_power_senate !== false))
        .filter((p: any) => {
          const key = `${p.state}:${p.district ?? p.chamber ?? p.name}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((p: any) => ({ p, coord: [p.lng, p.lat] as [number, number] }));
      const coords: [number, number][] = [dc];
      let current = dc;
      while (points.length) {
        let bestIndex = 0;
        let bestDistance = Infinity;
        for (let i = 0; i < points.length; i++) {
          const d = dist(current, points[i].coord);
          if (d < bestDistance) {
            bestDistance = d;
            bestIndex = i;
          }
        }
        const [next] = points.splice(bestIndex, 1);
        coords.push(next.coord);
        current = next.coord;
      }
      coords.push(dc);
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { party, name: `${party} power loop`, point_count: coords.length - 2 },
      };
    };
    const features = [
      activeLayers.power_edges_democrat ? makeLoop('Democrat') : null,
      activeLayers.power_edges_republican ? makeLoop('Republican') : null,
    ].filter((feature: any) => feature?.geometry.coordinates.length > 2);
    setGeo('power-edges', features);
  }, [mapReady, data.federal_power, activeLayers.power_edges, activeLayers.power_edges_democrat, activeLayers.power_edges_republican, activeLayers.federal_power_house, activeLayers.federal_power_senate, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('maritime', activeLayers.maritime && data.maritime_ports ? data.maritime_ports.map((p: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { name: p.name, country: p.country, type: p.type, volume: p.volume, fleet: p.fleet, rank: p.rank } })) : []);
    setGeo('maritime-choke', activeLayers.maritime && data.maritime_chokepoints ? data.maritime_chokepoints.map((c: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { name: c.name, traffic: c.traffic, risk: c.risk } })) : []);
    setGeo('maritime-ships', activeLayers.maritime && data.maritime_ships ? data.maritime_ships.map((s: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: { name: s.name || s.mmsi?.toString(), type: s.type || 'cargo', speed: s.speed, heading: s.heading, destination: s.destination, flag: s.flag } })) : []);
  }, [mapReady, data.maritime_ports, data.maritime_chokepoints, data.maritime_ships, activeLayers.maritime, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('balloons', activeLayers.balloons && data.balloons ? data.balloons.map((b: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [b.lng, b.lat] }, properties: { callsign: b.callsign, type: b.type, status: b.status, altitude: b.altitude, speed: b.speed, verticalRate: b.verticalRate, temperature: b.temperature, color: b.color } })) : []);
  }, [mapReady, data.balloons, activeLayers.balloons, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('radiation', activeLayers.radiation && data.radiation ? data.radiation.map((r: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] }, properties: { name: r.name, city: r.city, country: r.country, reading: r.reading, status: r.status, network: r.network } })) : []);
  }, [mapReady, data.radiation, activeLayers.radiation, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('live-news', activeLayers.live_news && data.live_feeds ? data.live_feeds.map((f: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] }, properties: { name: f.name, city: f.city, country: f.country, url: f.url, category: f.category, embed_allowed: f.embed_allowed !== false } })) : []);
  }, [mapReady, data.live_feeds, activeLayers.live_news, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    const items = data.news || [];
    setGeo('sigint-news', activeLayers.news_intel && items.length > 0
      ? items.filter((n: any) => n.coords?.length === 2).map((n: any) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [n.coords[1], n.coords[0]] },
          properties: { title: n.title, source: n.source, risk_score: n.risk_score, link: n.link }
        }))
      : []);
  }, [mapReady, data.news, activeLayers.news_intel, setGeo]);

  useEffect(() => {
    if (!mapReady) return;
    // ── CONFLICT ZONES — center-point warning markers ──
    const CONFLICT_ZONES = [
      { label: 'UKRAINE WAR', severity: 'war', lat: 48.5, lng: 31.2 },
      { label: 'GAZA CONFLICT', severity: 'war', lat: 31.35, lng: 34.35 },
      { label: 'LEBANON BORDER', severity: 'high', lat: 33.4, lng: 35.8 },
      { label: 'SUDAN CIVIL WAR', severity: 'war', lat: 15.0, lng: 30.0 },
      { label: 'MYANMAR CONFLICT', severity: 'war', lat: 19.5, lng: 96.5 },
      { label: 'DRC EASTERN CONFLICT', severity: 'war', lat: -1.0, lng: 28.5 },
      { label: 'YEMEN WAR', severity: 'war', lat: 15.5, lng: 48.0 },
      { label: 'SYRIA', severity: 'high', lat: 35.0, lng: 38.5 },
      { label: 'TAIWAN STRAIT', severity: 'elevated', lat: 24.0, lng: 119.5 },
      { label: 'KOREAN DMZ', severity: 'elevated', lat: 38.3, lng: 127.0 },
      { label: 'SAHEL INSTABILITY', severity: 'high', lat: 14.0, lng: 5.0 },
      { label: 'SOMALIA', severity: 'high', lat: 5.0, lng: 46.0 },
      { label: 'RED SEA THREAT', severity: 'high', lat: 16.0, lng: 40.0 },
    ];
    const conflictFeatures = CONFLICT_ZONES.map(z => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [z.lng, z.lat] },
      properties: { label: z.label, severity: z.severity },
    }));
    setGeo('conflict-zones', conflictFeatures);
  }, [mapReady, setGeo]);


  // Visibility
  useEffect(() => {
    if (!mapReady) return;
    setVis(['eq-circles','eq-label'], activeLayers.earthquakes);
    setVis(['sat-dots'], activeLayers.satellites);
    setVis(['gdelt-dots'], activeLayers.global_incidents);
    setVis(['jam-fill','jam-label'], activeLayers.gps_jamming);
    setVis(['day-night-fill'], activeLayers.day_night);
    setVis(['fl-commercial'], activeLayers.flights);
    setVis(['fl-private'], activeLayers.private);
    setVis(['fl-jets'], activeLayers.jets);
    setVis(['fl-military'], activeLayers.military);
    setVis(['cctv-glow','cctv-dots','cctv-label'], activeLayers.cctv);
    setVis(['fires-heat'], activeLayers.fires);
    setVis(['weather-glow','weather-dots','weather-label'], activeLayers.weather);
    setVis(['infra-glow','infra-dots','infra-label'], activeLayers.infrastructure);
    setVis(['hud-pha-bubbles','hud-pha-label'], activeLayers.hud_pha_flows);
    setVis(['sbir-recipient-glow','sbir-recipient-dots','sbir-recipient-label'], activeLayers.sbir_recipients);
    setVis(['education-org-glow','education-org-dots','education-org-label'], activeLayers.education_orgs);
    setVis(['workforce-org-glow','workforce-org-dots','workforce-org-label'], activeLayers.workforce_orgs);
    setVis(['health-org-glow','health-org-dots','health-org-label'], activeLayers.health_orgs);
    setVis(['funded-faith-org-glow','funded-faith-org-dots','funded-faith-org-label'], activeLayers.funded_faith_orgs);
    setVis(['sikeston-business-glow','sikeston-business-dots','sikeston-business-label'], activeLayers.sikeston_businesses);
    setVis(['sikeston-event-glow','sikeston-event-dots','sikeston-event-label'], activeLayers.sikeston_events);
    setVis(['power-dots','power-label'], activeLayers.federal_power || activeLayers.federal_power_house || activeLayers.federal_power_senate || activeLayers.federal_power_judicial || activeLayers.federal_power_white_house);
    setVis(['power-edge-glow','power-edge-lines'], activeLayers.power_edges && (activeLayers.power_edges_democrat || activeLayers.power_edges_republican));
    setVis(['maritime-glow','maritime-dots','maritime-label'], activeLayers.maritime);
    setVis(['choke-glow','choke-dots','choke-label'], activeLayers.maritime);
    setVis(['ship-dots','ship-label'], activeLayers.maritime);
    setVis(['news-glow','news-dots','news-label'], activeLayers.live_news);
    setVis(['sigint-news-glow','sigint-news-dots','sigint-news-label'], activeLayers.news_intel);
    setVis(['conflict-icons'], activeLayers.conflict_zones !== false);

    setVis(['balloon-dots','balloon-label'], activeLayers.balloons);
    setVis(['rad-glow','rad-dots','rad-label'], activeLayers.radiation);
    // Sweep layers always visible when data is present (controlled by useEffect)
    setVis(['sweep-connections','sweep-pulse-ring','sweep-device-glow','sweep-device-dots','sweep-device-labels'], true);
  }, [mapReady, activeLayers, setVis]);

  useEffect(() => {
    if (!mapReady || !activeLayers.power_edges || (!activeLayers.power_edges_democrat && !activeLayers.power_edges_republican)) return;
    const map = mapRef.current;
    if (!map?.getLayer('power-edge-lines')) return;
    let frame = 0;
    let raf = 0;
    const patterns = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5]];
    const animate = () => {
      if (map.getLayer('power-edge-lines')) {
        map.setPaintProperty('power-edge-lines', 'line-dasharray', patterns[frame % patterns.length]);
      }
      frame++;
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [mapReady, activeLayers.power_edges, activeLayers.power_edges_democrat, activeLayers.power_edges_republican]);

  // IP Sweep visualization
  useEffect(() => {
    if (!mapReady) return;
    if (!sweepData?.devices?.length) {
      setGeo('ip-sweep-devices', []);
      setGeo('ip-sweep-pulse', []);
      setGeo('ip-sweep-connections', []);
      return;
    }

    const map = mapRef.current;
    if (!map) return;

    const { center, devices } = sweepData;
    const centerCoord: [number, number] = [center.lng, center.lat];

    // Switch to globe and fly to the sweep location
    try {
      (map as any).setProjection({ type: 'globe' });
      map.setSky({ 'sky-color': '#0A0A0F', 'sky-horizon-blend': 0.02, 'horizon-color': '#0A0A0F', 'horizon-fog-blend': 0.02 });
    } catch { /* projection may not be supported */ }

    map.flyTo({ center: centerCoord, zoom: 14, pitch: 50, bearing: -20, duration: 3000, essential: true });

    // Set center pulse
    setGeo('ip-sweep-pulse', [{
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: centerCoord },
      properties: { ip: sweepData.target_ip },
    }]);

    // Build device features spread in a circle around center
    const allDeviceFeatures = devices.map((d: any, i: number) => {
      const angle = (i / devices.length) * Math.PI * 2;
      const radius = 0.001 + ((i % 7 + 1) * 0.0004);
      const dLng = centerCoord[0] + Math.cos(angle) * radius * (1 / Math.cos(center.lat * Math.PI / 180));
      const dLat = centerCoord[1] + Math.sin(angle) * radius;
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [dLng, dLat] },
        properties: {
          ip: d.ip, device_type: d.device_type, device_icon: d.device_icon,
          color: d.device_color, risk_level: d.risk_level,
          ports: JSON.stringify(d.ports), hostnames: JSON.stringify(d.hostnames),
          vulns: JSON.stringify(d.vulns), cpes: JSON.stringify(d.cpes), tags: JSON.stringify(d.tags),
        },
      };
    });

    // Connection lines from center to each device
    const connectionFeatures = allDeviceFeatures.map((f: any) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: [centerCoord, f.geometry.coordinates] },
      properties: { color: f.properties.color },
    }));

    // Stagger the appearance after 3s flyTo completes
    const timer = setTimeout(() => {
      setGeo('ip-sweep-connections', connectionFeatures);
      const batchSize = 5;
      const batches = Math.ceil(allDeviceFeatures.length / batchSize);
      for (let b = 0; b < batches; b++) {
        setTimeout(() => {
          setGeo('ip-sweep-devices', allDeviceFeatures.slice(0, (b + 1) * batchSize));
        }, b * 100);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [mapReady, sweepData, setGeo]);

  // Scan Targets visualization
  useEffect(() => {
    if (!mapReady || !mapRef.current || !scanTargets) return;
    const map = mapRef.current;
    
    const features = scanTargets.map(t => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [t.lng, t.lat] },
      properties: { ...t }
    }));
    
    const src = map.getSource('scan-targets') as maplibregl.GeoJSONSource;
    if (src) src.setData({ type: 'FeatureCollection', features });
  }, [scanTargets, mapReady]);

  // Fly-to
  useEffect(() => {
    if (!mapReady || !mapRef.current || !flyToLocation) return;
    mapRef.current.flyTo({ center: [flyToLocation.lng, flyToLocation.lat], zoom: 8, duration: 2000 });
  }, [mapReady, flyToLocation]);

  // Dynamic projection switching (lightweight — no terrain DEM)
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    try {
      (map as any).setProjection({ type: projection });
      if (projection === 'globe') {
        map.easeTo({ pitch: 20, duration: 1200 });
        try {
          (map as any).setSky({
            'sky-color': '#04040A',
            'sky-horizon-blend': 0.5,
            'horizon-color': '#0a0a1a',
            'horizon-fog-blend': 0.3,
            'fog-color': '#04040A',
            'fog-ground-blend': 0.9,
          });
        } catch (e) { console.warn('[AutoNateAI Intel] Suppressed error:', e instanceof Error ? e.message : e); }
      } else {
        map.easeTo({ pitch: 0, duration: 800 });
      }
    } catch (e) {
      console.warn('Projection switch failed:', e);
    }
  }, [mapReady, projection]);

  // Base theme / satellite style switching
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (mapStyle === prevStyleRef.current) return;
    prevStyleRef.current = mapStyle;
    const map = mapRef.current;

    try {
      if (mapStyle === 'light') {
        if (!map.getSource('light-tiles')) {
          map.addSource('light-tiles', {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 18,
          });
          map.addLayer({ id: 'light-layer', type: 'raster', source: 'light-tiles', paint: { 'raster-opacity': 0.9 } }, 'day-night-fill');
        } else {
          map.setLayoutProperty('light-layer', 'visibility', 'visible');
        }
        if (map.getLayer('satellite-layer')) {
          map.setLayoutProperty('satellite-layer', 'visibility', 'none');
        }
      } else if (mapStyle === 'satellite') {
        if (map.getLayer('light-layer')) {
          map.setLayoutProperty('light-layer', 'visibility', 'none');
        }
        // Add satellite raster tiles
        if (!map.getSource('satellite-tiles')) {
          map.addSource('satellite-tiles', {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 18,
          });
          map.addLayer({ id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 0.85 } }, 'day-night-fill');
        } else {
          map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
        }
      } else {
        if (map.getLayer('light-layer')) {
          map.setLayoutProperty('light-layer', 'visibility', 'none');
        }
        if (map.getLayer('satellite-layer')) {
          map.setLayoutProperty('satellite-layer', 'visibility', 'none');
        }
      }
      BASE_CHOROPLETH_LAYERS.forEach((layer) => {
        if (!map.getLayer(layer)) return;
        map.setLayoutProperty(layer, 'visibility', mapStyle === 'satellite' ? 'none' : 'visible');
        if (map.getLayer('day-night-fill')) map.moveLayer(layer, 'day-night-fill');
      });
    } catch (e) {
      console.warn('Style switch failed:', e);
    }
  }, [mapReady, mapStyle]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}

export default memo(OsirisMap);
