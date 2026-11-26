export function parseLatestYml(text: string): { version: string | null; files: { url: string; sha512: string | null; size: number | null }[] }
export function verifyBuild(input: { version: string; latestYml: string | null; distFiles: string[]; productPrefix?: string }): string[]
