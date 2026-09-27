export type AppEnv = 'development' | 'preview' | 'production';
export type ApiUrlResult = { ok: true; url: string } | { ok: false; error: string };
export declare const APP_ENVS: readonly AppEnv[];
export declare const DEV_API_PORT: number;
export declare function parseAppEnv(value: unknown): AppEnv;
export declare function isLocalOrPrivateHost(host: string): boolean;
export declare function validateReleaseApiUrl(raw: string | undefined): ApiUrlResult;
export declare function resolveApiUrl(input: { appEnv: AppEnv; envUrl?: string; hostUri?: string | null; isDevBundle: boolean }): ApiUrlResult;
