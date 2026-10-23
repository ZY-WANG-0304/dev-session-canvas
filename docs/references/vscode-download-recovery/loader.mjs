export async function resolve(specifier, context, next) {
 if(specifier==='@vscode/test-electron' && context.parentURL?.endsWith('/download-vscode-attempt.mjs'))
  return {url:new URL('./mock.mjs',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}
