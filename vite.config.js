import { defineConfig } from 'vite';

export default defineConfig({
    publicDir: 'public',
    server: {
        'host': '0.0.0.0',
        proxy: {
            // REST
            '/verifyaccount': { target: 'http://localhost:3000', changeOrigin: true },
            '/createaccount': { target: 'http://localhost:3000', changeOrigin: true },
            '/login':         { target: 'http://localhost:3000', changeOrigin: true },
            '/logout':        { target: 'http://localhost:3000', changeOrigin: true },
            // Socket.IO (note ws: true)
            '/socket.io':     { target: 'http://localhost:3001', changeOrigin: true, ws: true },
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: 'index.html',
                dashboard: 'dashboard.html'
            }
        }
    }
});