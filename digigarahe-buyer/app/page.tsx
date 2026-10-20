'use client';

import { useEffect, useState } from 'react';

interface Product {
  id: string;
  title: string;
  category: string;
  condition?: string;
  estimatedPricePHP?: number;
  description?: string;
  images?: string[];
  facebookCopy?: string;
  carousellCopy?: string;
}

export default function BuyerMarketplace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [activeImageIndexes, setActiveImageIndexes] = useState<Record<string, number>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/products', { cache: 'no-store' });
      const data = await res.json();
      if (Array.isArray(data)) {
        setProducts(data);
      }
    } catch (err) {
      console.error('Failed to load products', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    const interval = setInterval(fetchProducts, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectThumbnail = (productId: string, index: number) => {
    setActiveImageIndexes((prev) => ({
      ...prev,
      [productId]: index,
    }));
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-12">
      <div className="max-w-6xl mx-auto">
        <header className="mb-10">
          <h1 className="text-3xl font-extrabold text-slate-900 mb-1">DigiGarahe Market 🧸📺</h1>
          <p className="text-slate-600">AI-Verified Secondhand Finds from Local Sellers</p>
        </header>

        {loading ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-slate-500 text-lg animate-pulse">Loading market finds...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-slate-400 text-lg mb-2">No garage sale listings yet.</p>
            <p className="text-slate-500 text-sm">Publish an item from your mobile app to see it appear here instantly!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => {
              const activeIndex = activeImageIndexes[product.id] || 0;
              const currentImage = product.images?.[activeIndex] || '/placeholder.png';

              return (
                <div key={product.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  {/* Image Preview Box */}
                  <div className="relative h-64 bg-slate-100 cursor-pointer" onClick={() => setSelectedImage(currentImage)}>
                    <img 
                      src={currentImage} 
                      alt={product.title} 
                      className="w-full h-full object-cover"
                    />
                    {product.condition && (
                      <span className="absolute top-3 right-3 bg-slate-900/80 text-white text-xs px-2.5 py-1 rounded-full font-medium">
                        {product.condition}
                      </span>
                    )}
                  </div>

                  {/* Thumbnails if multiple images exist */}
                  {product.images && product.images.length > 1 && (
                    <div className="flex gap-2 p-3 bg-slate-50 border-b border-slate-100 overflow-x-auto">
                      {product.images.map((imgUrl, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSelectThumbnail(product.id, idx)}
                          className={`w-12 h-12 rounded-lg overflow-hidden border-2 shrink-0 ${idx === activeIndex ? 'border-indigo-600' : 'border-transparent'}`}
                        >
                          <img src={imgUrl} alt="thumbnail" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Content Details */}
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <h2 className="font-bold text-slate-900 text-lg leading-snug">{product.title}</h2>
                        <span className="text-indigo-600 font-extrabold text-lg shrink-0">
                          ₱{product.estimatedPricePHP?.toLocaleString() || '0'}
                        </span>
                      </div>
                      <span className="inline-block bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-md mb-3">
                        {product.category || 'General'}
                      </span>
                      <p className="text-slate-600 text-sm mb-4 line-clamp-3">
                        {product.description || 'No description provided.'}
                      </p>
                    </div>

                    {/* Cross-Post / Copy Actions */}
                    {product.facebookCopy && (
                      <div className="pt-3 border-t border-slate-100 flex gap-2">
                        <button
                          onClick={() => handleCopyText(product.facebookCopy || '', product.id)}
                          className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold py-2 px-3 rounded-lg transition"
                        >
                          {copiedId === product.id ? '✅ Copied FB Copy!' : '📋 Copy for FB Marketplace'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Lightbox Modal */}
        {selectedImage && (
          <div 
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setSelectedImage(null)}
          >
            <img src={selectedImage} alt="Fullscreen preview" className="max-w-full max-h-[90vh] rounded-xl object-contain" />
          </div>
        )}
      </div>
    </main>
  );
}
