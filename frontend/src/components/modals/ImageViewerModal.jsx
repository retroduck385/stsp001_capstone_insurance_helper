/**
 * Full-screen image lightbox.
 * `image` is null when closed, otherwise { url, label, caption }.
 */
export default function ImageViewerModal({ image, onClose }) {
  if (!image) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex flex-col justify-between p-6 z-50"
      onClick={onClose}
    >
      <div className="flex justify-between items-center text-white z-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center space-x-2">
          <span className="bg-blue-600 text-xs font-bold px-2 py-1 rounded">IMAGE INSPECTOR</span>
          <h3 className="text-sm font-bold text-slate-200">{image.label}</h3>
        </div>
        <button
          onClick={onClose}
          className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-1.5 rounded-lg border border-slate-700 text-xs transition"
        >
          ✕ Close Viewer (ESC)
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <img
          src={image.url}
          alt={image.label}
          className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl border border-slate-700"
        />
      </div>

      <div className="bg-slate-900/90 text-slate-200 p-3 rounded-lg border border-slate-800 text-xs max-w-2xl mx-auto text-center" onClick={(e) => e.stopPropagation()}>
        <strong>Details:</strong> {image.caption}
      </div>
    </div>
  );
}
