// oidc-provider has no type declarations of its own, the tests only use a
// little of it
declare module 'oidc-provider' {
  const Provider: any;
  export default Provider;
}
