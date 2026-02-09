import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { log } from './logger.js';

const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestWithRetry<T>(
  config: AxiosRequestConfig,
  retries = MAX_RETRIES
): Promise<AxiosResponse<T>> {
  try {
    return await axios(config);
  } catch (error) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const shouldRetry =
      retries > 0 && (!status || status === 503 || status === 429 || status >= 500);

    if (shouldRetry) {
      const delay = INITIAL_DELAY * (MAX_RETRIES - retries + 1);
      log.warn(
        `Request failed (${status || 'timeout'}). Retrying in ${delay}ms... (${
          MAX_RETRIES - retries + 1
        }/${MAX_RETRIES})`
      );
      await sleep(delay);
      return requestWithRetry(config, retries - 1);
    }

    throw error;
  }
}
