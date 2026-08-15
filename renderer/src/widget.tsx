import React from 'react';
import ReactDOM from 'react-dom/client';
import { WidgetApp } from './WidgetApp';
import './index.css';

// 悬浮小窗专用：透明背景
document.documentElement.classList.add('widget-page');
document.body.style.margin = '0';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WidgetApp />
  </React.StrictMode>
);
