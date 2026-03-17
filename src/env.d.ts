declare const __AGITO_PUBLIC_CONFIG__: import('./shared/public-config').AgitoPublicConfig

declare module '*.png' {
  const src: string
  export default src
}
