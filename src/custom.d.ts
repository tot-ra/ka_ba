// Tell TypeScript that importing .module.css files is okay and what type they have.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// If you also use regular .css files and want to import them:
// declare module '*.css';

// Add declarations for other asset types if needed, e.g.:
// declare module '*.svg' {
//   const content: any;
//   export default content;
// }
