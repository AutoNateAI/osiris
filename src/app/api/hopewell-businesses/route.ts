import { NextResponse } from 'next/server';
import { fetchHopewellBusinesses } from '@/lib/hopewell';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const geocode = searchParams.get('geocode') === '1';
    const limit = Number(searchParams.get('limit') || 600);
    const data = await fetchHopewellBusinesses({ geocode, limit });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Hopewell Businesses API]', error);
    return NextResponse.json({ error: 'Failed to fetch Hopewell businesses' }, { status: 500 });
  }
}
