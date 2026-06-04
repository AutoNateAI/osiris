import { NextResponse } from 'next/server';
import { fetchHopewellEvents } from '@/lib/hopewell';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const months = searchParams.getAll('month');
    const geocode = searchParams.get('geocode') === '1';
    const limit = Number(searchParams.get('limit') || 250);
    const data = await fetchHopewellEvents({ months: months.length ? months : undefined, geocode, limit });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Hopewell Events API]', error);
    return NextResponse.json({ error: 'Failed to fetch Hopewell events' }, { status: 500 });
  }
}
