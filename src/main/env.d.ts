// electron-vite builds a file given with ?modulePath as its own program and gives its path.
declare module '*?modulePath' {
  const path: string
  export default path
}

// The Google login key for Drive sync. It comes from .env.local (never committed) or from the release build's secrets.
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
