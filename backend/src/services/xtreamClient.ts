import axios, { type AxiosInstance } from 'axios';

// Ports xtreamClient.js verbatim.
export class XtreamClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private client: AxiosInstance;

  constructor(baseUrl: string, username: string, password: string, userAgent = 'Xtream-JS-Client') {
    if (!baseUrl || typeof baseUrl !== 'string') {
      throw new Error('[XC Client Constructor] Invalid or missing baseUrl provided.');
    }
    try {
      const url = new URL(baseUrl);
      this.baseUrl = `${url.protocol}//${url.host}`;
    } catch (e) {
      console.error(`[XC Client Constructor] Failed to parse baseUrl "${baseUrl}": ${(e as Error).message}`);
      throw new Error(`[XC Client Constructor] Invalid baseUrl format: "${baseUrl}". Please provide a valid URL (e.g., http://example.com:8080).`);
    }

    this.username = username;
    this.password = password;

    this.client = axios.create({
      timeout: 60000,
      headers: { 'User-Agent': userAgent },
    });
    console.log(`[XC Client Constructor] Client initialized for base URL: ${this.baseUrl} with User-Agent: ${userAgent}`);
  }

  private async _makeRequest<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      const url = `${this.baseUrl}/player_api.php`;
      const allParams = { username: this.username, password: this.password, action, ...params };
      console.log(`[XC Client] Requesting action: ${action}`);
      const response = await this.client.get(url, { params: allParams });
      if (!response.data) {
        throw new Error('Empty response from provider');
      }
      return response.data as T;
    } catch (error) {
      const msg = `[XC Client] Error in action '${action}': ${(error as Error).message}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  getVodStreams() { return this._makeRequest('get_vod_streams'); }
  getSeries() { return this._makeRequest('get_series'); }
  getVodInfo(vodId: string | number) { return this._makeRequest('get_vod_info', { vod_id: vodId }); }
  getSeriesInfo(seriesId: string | number) { return this._makeRequest('get_series_info', { series_id: seriesId }); }
  getVodCategories() { return this._makeRequest<Array<{ category_id: string; category_name: string }>>('get_vod_categories'); }
  getSeriesCategories() { return this._makeRequest<Array<{ category_id: string; category_name: string }>>('get_series_categories'); }
  getLiveCategories() { return this._makeRequest<Array<{ category_id: string; category_name: string }>>('get_live_categories'); }

  async getAllCategories(): Promise<string[]> {
    try {
      console.log('[XC Client] Fetching all category types concurrently...');
      const [live, vod, series] = await Promise.all([
        this.getLiveCategories(),
        this.getVodCategories(),
        this.getSeriesCategories(),
      ]);

      const allCategories = new Set<string>();
      if (Array.isArray(live)) live.forEach((c) => allCategories.add(c.category_name));
      if (Array.isArray(vod)) vod.forEach((c) => allCategories.add(c.category_name));
      if (Array.isArray(series)) series.forEach((c) => allCategories.add(c.category_name));

      const sortedCategories = Array.from(allCategories).sort((a, b) => a.localeCompare(b));
      console.log(`[XC Client] Found ${sortedCategories.length} unique categories across all types.`);
      return sortedCategories;
    } catch (error) {
      console.error(`[XC Client] Failed to fetch all categories: ${(error as Error).message}`);
      throw new Error(`Failed to fetch all categories: ${(error as Error).message}`);
    }
  }
}

export default XtreamClient;
