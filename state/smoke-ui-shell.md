# Smoke UI Shell

- status: VERDE
- exit_code: 0
- duration_ms: 546
- dist/public/index.html: 1.05 kB (gzip: 0.47 kB)
- dist/public/assets/index-H04csBQE.css: 2.92 kB (gzip: 1.00 kB)
- dist/public/assets/index-BNP-tf8i.js: 4.13 kB (gzip: 1.80 kB)
- modules transformed: 5

## stdout

```
vite v5.4.21 building for production...
transforming...
✓ 5 modules transformed.
rendering chunks...
computing gzip size...
dist/public/index.html                 1.05 kB │ gzip: 0.47 kB
dist/public/assets/index-H04csBQE.css  2.92 kB │ gzip: 1.00 kB
dist/public/assets/index-BNP-tf8i.js   4.13 kB │ gzip: 1.80 kB
✓ built in 87ms
```

## fix aplicado

vite.config.js: root='.', outDir='dist/public', port=5173, proxy /api -> :5176.

## conclusion

Build VERDE. Listo para encadenar visor-ui-views.
