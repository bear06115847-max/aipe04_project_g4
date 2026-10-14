export interface ApiErrorBody {
  code: string
  message: string
  details?: string[]
}

export interface ApiErrorResponse {
  error: ApiErrorBody
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorResponse,
  ) {
    super(body.error.message)
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const body = await response.json()

  if (!response.ok) {
    throw new ApiError(response.status, body)
  }

  return body as T
}