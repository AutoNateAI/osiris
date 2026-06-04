import { NextResponse } from 'next/server';
import { fetchSikestonEvents } from '@/lib/sikeston';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const geocode = searchParams.get('geocode') === '1';
  const limit = Number(searchParams.get('limit') || 200);
  const months = searchParams.getAll('month').filter(Boolean);
  const data = await fetchSikestonEvents({ geocode, limit, months: months.length ? months : undefined });
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
  });
}
