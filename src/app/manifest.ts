import type { MetadataRoute } from 'next';

// 홈 화면에 추가(PWA)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '새한 프라텍',
    short_name: '새한 프라텍',
    description: '교대제 공장 인력 자동 배치 · 결원 대체',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f6fa',
    theme_color: '#16335b',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
