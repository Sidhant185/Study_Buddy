const Sidebar = ({ items, activeSection, open, onClose, onSelect }) => (
  <>
    <aside
      className={`fixed inset-y-0 left-0 z-10 w-[280px] bg-slate-900 text-slate-100 flex flex-col p-6 transition-transform duration-200 ease-in-out ${
        open ? "translate-x-0" : "-translate-x-full"
      } lg:translate-x-0`}
      id="sidebar"
    >
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg">
            VB
          </div>
          <div>
            <p className="font-semibold text-sm">Vedam Study Buddy</p>
            <small className="text-xs text-slate-400">Contest Analytics</small>
          </div>
        </div>
        <button
          className="lg:hidden text-slate-400 hover:text-white px-2 py-1 text-sm"
          type="button"
          onClick={onClose}
        >
          Hide
        </button>
      </div>

      <nav className="flex-1 space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
              activeSection === item.id
                ? "bg-emerald-600 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
            onClick={() => onSelect(item.id)}
          >
            <span className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-semibold">
              {item.icon}
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium">{item.label}</span>
              <small className="block text-xs opacity-75">{item.tagline}</small>
            </span>
          </button>
        ))}
      </nav>
    </aside>

    {open && (
      <button
        type="button"
        className="fixed inset-0 bg-black bg-opacity-50 z-[5] lg:hidden"
        aria-label="Close navigation"
        onClick={onClose}
      >
        <span className="sr-only">Close navigation</span>
      </button>
    )}
  </>
);

export default Sidebar;

