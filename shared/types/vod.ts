export interface Movie {
  id: number;
  name: string;
  year: number | null;
  description: string | null;
  logo: string | null;
  tmdb_id: string | null;
  imdb_id: string | null;
  category_name: string | null;
  provider_unique_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Series {
  id: number;
  name: string;
  year: number | null;
  description: string | null;
  logo: string | null;
  tmdb_id: string | null;
  imdb_id: string | null;
  category_name: string | null;
  provider_unique_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Episode {
  id: number;
  series_id: number;
  season_num: number;
  episode_num: number;
  name: string | null;
  description: string | null;
  air_date: string | null;
  tmdb_id: string | null;
  imdb_id: string | null;
  created_at: string;
  updated_at: string;
}
