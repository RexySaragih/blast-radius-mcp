/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-application-no-infra',
      comment:
        'Domain and application must not import clients, tools, adapters, MCP SDK, sqlite, tree-sitter, child_process, or zod',
      severity: 'error',
      from: { path: '^src/(domain|application)' },
      to: {
        path: '(^src/(clients|tools|adapters|composition)|node:sqlite|web-tree-sitter|@modelcontextprotocol/sdk|node:child_process|^zod$)',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
