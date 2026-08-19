import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

/**
 * Multi-provider chat completion for the AI agent. Mirrors MultiAI's
 * provider-order + failover pattern (Gemini → OpenAI → Grok → DeepSeek) so a
 * single provider outage never breaks the assistant. Returns '' if no provider
 * is configured or every call fails — the agent route then falls back to a
 * deterministic, data-grounded reply.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const REQUEST_TIMEOUT_MS = 30000;

export async function runAssistantChat(system: string, messages: ChatMessage[], maxOutputTokens = 1500): Promise<string> {
  const providers: { name: string; runner: () => Promise<string | null> }[] = [
    { name: 'Gemini', runner: () => callGemini(system, messages) },
    { name: 'OpenAI', runner: () => callOpenAI(system, messages, maxOutputTokens) },
    { name: 'Groq', runner: () => callGrok(system, messages, maxOutputTokens) },
    { name: 'DeepSeek', runner: () => callDeepSeek(system, messages, maxOutputTokens) },
  ];

  for (const provider of providers) {
    if (isConfigured(provider.name)) {
      try {
        const text = await provider.runner();
        if (text && text.trim()) return text.trim();
      } catch (error) {
        console.warn(`[Agent] ${provider.name} failed:`, error);
      }
    }
  }
  return '';
}

function isConfigured(provider: string): boolean {
  switch (provider) {
    case 'Gemini': return Boolean(process.env.GEMINI_API_KEY);
    case 'OpenAI': return Boolean(process.env.OPENAI_API_KEY);
    case 'Groq': return Boolean(process.env.GROK_API_KEY);
    case 'DeepSeek': return Boolean(process.env.DEEPSEEK_API_KEY);
    default: return false;
  }
}

function buildMessages(system: string, messages: ChatMessage[]) {
  const history = messages.slice(-10).map(m => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: m.content.slice(0, 2000),
  }));
  return [{ role: 'system' as const, content: system }, ...history];
}

async function callGemini(system: string, messages: ChatMessage[]): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const conversation = buildMessages(system, messages)
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: conversation,
    });
    return response.text ?? null;
  } catch {
    return null;
  }
}

async function callOpenAI(system: string, messages: ChatMessage[], maxOutputTokens: number): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  const response = await client.responses.create({
    model: 'gpt-4.1-mini',
    input: buildMessages(system, messages),
    max_output_tokens: maxOutputTokens,
  });
  const text = typeof response === 'string' ? response : (response.output_text ?? '');
  return text || null;
}

async function callGrok(system: string, messages: ChatMessage[], maxOutputTokens: number): Promise<string | null> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: buildMessages(system, messages),
        max_tokens: maxOutputTokens,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await response.json();
    return payload?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function callDeepSeek(system: string, messages: ChatMessage[], maxOutputTokens: number): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: buildMessages(system, messages),
      max_tokens: maxOutputTokens,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content ?? null;
}
