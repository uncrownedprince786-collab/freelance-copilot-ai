import { NextResponse } from 'next/server';
import { MultiAI } from '../../../services/ai/MultiAI';

export async function POST(request: Request) {
  const { title, description, platform, budget } = await request.json();

  const analysis = await new MultiAI().analyze(title || '', description || '', {
    platform,
    budget
  });

  return NextResponse.json(analysis);
}