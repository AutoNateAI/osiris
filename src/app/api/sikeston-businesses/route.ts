import { NextResponse } from 'next/server';
import { fetchSikestonBusinesses } from '@/lib/sikeston';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const geocode = searchParams.get('geocode') === '1';
  const limit = Number(searchParams.get('limit') || 400);
  const data = await fetchSikestonBusinesses({ geocode, limit });
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
  });
}
