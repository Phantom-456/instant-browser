// electron-vite builds a file given with ?modulePath as its own program and gives its path.
declare module '*?modulePath' {
  const path: string
  export default path
}
