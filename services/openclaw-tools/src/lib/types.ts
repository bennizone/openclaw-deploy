export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "minimax" | "ddg";
  date?: string;
}

export interface MiniMaxSearchResponse {
  organic: Array<{
    title: string;
    link: string;
    snippet: string;
    date?: string;
  }>;
  related_searches?: Array<{ query: string }>;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}

export interface MiniMaxVLMResponse {
  content: string;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}
