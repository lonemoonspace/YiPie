import { describe, expect, it } from 'vitest';
import { normalizeBaseURL } from '@/domain/url';
import {
  FREE_SERVICES,
  KEY_SERVICES,
  LOCAL_SERVERS,
  chatModels,
  pickModel,
} from '@/domain/onboarding';
import { parseWelcomeHash, welcomeHash } from '@/domain/welcome-hash';

describe('the first-run lists', () => {
  it('give every service a usable address, a key page and a model to fall back on', () => {
    for (const service of [...KEY_SERVICES, ...FREE_SERVICES]) {
      expect(normalizeBaseURL(service.baseURL), service.id).toEqual({
        ok: true,
        value: service.baseURL,
      });
      expect(service.keyURL, service.id).toMatch(/^https:\/\//);
      expect(service.models.length, service.id).toBeGreaterThan(0);
    }
    const ids = [...KEY_SERVICES, ...FREE_SERVICES].map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('look for local servers on this machine only', () => {
    for (const server of LOCAL_SERVERS) {
      expect(new URL(server.baseURL).hostname).toBe('localhost');
    }
  });
});

describe('pickModel', () => {
  const service = { models: ['glm-4-flash', 'glm-4-plus'] };

  it('takes the first preferred model the service lists', () => {
    expect(pickModel(['glm-4-plus', 'glm-4-flash', 'glm-4-air'], service)).toBe('glm-4-flash');
    expect(pickModel(['glm-4-plus', 'glm-4-air'], service)).toBe('glm-4-plus');
  });

  it('matches a preferred model behind a prefix the service adds', () => {
    expect(
      pickModel(['models/gemini-2.0-flash', 'models/gemini-2.5-flash'], {
        models: ['gemini-2.5-flash'],
      }),
    ).toBe('models/gemini-2.5-flash');
  });

  it('otherwise takes the first chat model, skipping embeddings, speech and images', () => {
    expect(
      pickModel(
        ['text-embedding-3-small', 'whisper-1', 'dall-e-3', 'tts-1', 'some-chat-model'],
        service,
      ),
    ).toBe('some-chat-model');
  });

  it('picks among the free models of a free-only service', () => {
    const openrouter = { models: ['missing:free'], freeOnly: true };
    expect(pickModel(['a/paid', 'z/model:free', 'b/model:free'], openrouter)).toBe('b/model:free');
    expect(pickModel(['a/paid'], openrouter)).toBeNull();
  });

  it('is null for an empty list or one with no chat model', () => {
    expect(pickModel([], service)).toBeNull();
    expect(pickModel(['bge-m3', 'text-embedding-v3'], null)).toBeNull();
  });
});

describe('chatModels', () => {
  it('lists the chat models in order, each once', () => {
    expect(chatModels(['qwen2.5:7b', 'nomic-embed-text', 'llama3.2', 'qwen2.5:7b'])).toEqual([
      'llama3.2',
      'qwen2.5:7b',
    ]);
  });
});

describe('the first-run hash', () => {
  it('round-trips each path, and the page without one', () => {
    expect(parseWelcomeHash(welcomeHash())).toEqual({ path: null });
    for (const path of ['key', 'free', 'local'] as const) {
      expect(parseWelcomeHash(welcomeHash(path))).toEqual({ path });
    }
  });

  it('ignores an unknown path and any other hash', () => {
    expect(parseWelcomeHash('#welcome/nope')).toEqual({ path: null });
    expect(parseWelcomeHash('#model-heading')).toBeNull();
    expect(parseWelcomeHash('')).toBeNull();
  });
});
