import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { DEFAULT_CONFIG } from '../../config/defaults.js';
import { log } from './logger.js';

const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;
const RETRIABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRIABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ETIMEDOUT',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestWithRetry<T>(
  config: AxiosRequestConfig,
  retries = MAX_RETRIES,
): Promise<AxiosResponse<T>> {
  const requestConfig = {
    ...config,
    timeout: config.timeout ?? DEFAULT_CONFIG.requestTimeout,
  };

  for (let attempt = 0; ; attempt++) {
    try {
      return await axios<T>(requestConfig);
    } catch (error) {
      if (!axios.isAxiosError(error)) throw error;

      const status = error.response?.status;
      const retriable = status
        ? RETRIABLE_STATUS_CODES.has(status)
        : RETRIABLE_ERROR_CODES.has(error.code || '');
      if (!retriable || attempt >= retries) throw error;

      const delay = INITIAL_DELAY * (attempt + 1);
      log.warn(
        `Request failed (${status ?? error.code}). Retrying in ${delay}ms... (${attempt + 1}/${retries})`,
      );
      await sleep(delay);
    }
  }
}
