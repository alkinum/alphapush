export interface ApiToken {
  id: string;
  name: string;
  token: string;
  expiresAt: number | null;
}

export interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
}

export interface ApiTokensResponse {
  tokens: ApiToken[];
  pagination: PaginationInfo;
}

export interface CreateTokenBody {
  name: string;
  expiresIn: number; // Number of days, 0 means never expire
}

export interface CreateTokenResponse {
  token: string;
}
