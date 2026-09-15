import { KnexStreamHistoryRepository } from './KnexStreamHistoryRepository';
import type { IStreamHistoryRepository } from './IStreamHistoryRepository';

export const streamHistoryRepository: IStreamHistoryRepository = new KnexStreamHistoryRepository();

export type { IStreamHistoryRepository, CreateStreamHistoryInput } from './IStreamHistoryRepository';
export { KnexStreamHistoryRepository } from './KnexStreamHistoryRepository';
