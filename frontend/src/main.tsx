import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { DocumentsPage } from './pages/DocumentsPage.tsx';
import { DocumentPage } from './pages/DocumentPage.tsx';
import { UploadPage } from './pages/UploadPage.tsx';
import { ReviewPage } from './pages/ReviewPage.tsx';
import { ProblemsPage } from './pages/ProblemsPage.tsx';
import { installAuthRedirect } from './auth.tsx';
import './index.css';

installAuthRedirect();

// Search used to be its own page; keep old /search?... links working.
function SearchRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/${search}`} replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DocumentsPage />} />
          <Route path="/search" element={<SearchRedirect />} />
          <Route path="/documents/:id" element={<DocumentPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/problems" element={<ProblemsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
