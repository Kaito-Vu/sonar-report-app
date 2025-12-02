// Global App Utilities
(function() {
  'use strict';

  // ============================================
  // 1. DARK MODE
  // ============================================
  const darkMode = {
    init() {
      const saved = localStorage.getItem('darkMode');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = saved === 'true' || (!saved && prefersDark);
      
      if (isDark) {
        document.documentElement.classList.add('dark');
      }
      
      this.updateToggle();
    },
    
    toggle() {
      document.documentElement.classList.toggle('dark');
      const isDark = document.documentElement.classList.contains('dark');
      localStorage.setItem('darkMode', isDark);
      this.updateToggle();
    },
    
    updateToggle() {
      const toggle = document.getElementById('darkModeToggle');
      if (toggle) {
        const isDark = document.documentElement.classList.contains('dark');
        toggle.innerHTML = isDark 
          ? '<span class="iconify" data-icon="mdi:weather-sunny"></span>'
          : '<span class="iconify" data-icon="mdi:weather-night"></span>';
      }
    }
  };

  // ============================================
  // 2. KEYBOARD SHORTCUTS
  // ============================================
  const shortcuts = {
    init() {
      document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K: Search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          const searchInput = document.querySelector('#searchInput, input[type="search"]');
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
        }
        
        // Ctrl/Cmd + N: New Project
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
          e.preventDefault();
          const newBtn = document.querySelector('[onclick*="openAddProjectModal"], [onclick*="addProject"]');
          if (newBtn) newBtn.click();
        }
        
        // ?: Show shortcuts help
        if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          this.showHelp();
        }
        
        // Escape: Close modals
        if (e.key === 'Escape') {
          const modals = document.querySelectorAll('[id$="Modal"]:not(.hidden)');
          modals.forEach(modal => {
            if (modal.id === 'confirmModal') {
              closeConfirmModal();
            } else {
              modal.classList.add('hidden');
            }
          });
        }
      });
    },
    
    showHelp() {
      const helpModal = document.getElementById('shortcutsHelp');
      if (helpModal) {
        helpModal.classList.remove('hidden');
      } else {
        this.createHelpModal();
      }
    },
    
    createHelpModal() {
      const modal = document.createElement('div');
      modal.id = 'shortcutsHelp';
      modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center';
      modal.innerHTML = `
        <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onclick="this.closest('#shortcutsHelp').remove()"></div>
        <div class="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
          <div class="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <h3 class="text-lg font-bold text-slate-800 dark:text-slate-200">Keyboard Shortcuts</h3>
            <button onclick="this.closest('#shortcutsHelp').remove()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
              <span class="iconify w-6 h-6" data-icon="mdi:close"></span>
            </button>
          </div>
          <div class="p-6 space-y-4">
            <div class="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700">
              <span class="text-slate-600 dark:text-slate-300">Search</span>
              <kbd class="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-sm font-mono">Ctrl+K</kbd>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700">
              <span class="text-slate-600 dark:text-slate-300">New Project</span>
              <kbd class="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-sm font-mono">Ctrl+N</kbd>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700">
              <span class="text-slate-600 dark:text-slate-300">Show Shortcuts</span>
              <kbd class="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-sm font-mono">?</kbd>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700">
              <span class="text-slate-600 dark:text-slate-300">Close Modal</span>
              <kbd class="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-sm font-mono">Esc</kbd>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700">
              <span class="text-slate-600 dark:text-slate-300">Toggle Dark Mode</span>
              <kbd class="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-sm font-mono">Ctrl+Shift+D</kbd>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
  };

  // ============================================
  // 3. SEARCH & FILTER UTILITIES
  // ============================================
  const searchFilter = {
    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },
    
    filterTable(searchTerm, tableSelector) {
      const table = document.querySelector(tableSelector);
      if (!table) return;
      
      const rows = table.querySelectorAll('tbody tr');
      const term = searchTerm.toLowerCase();
      
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(term) ? '' : 'none';
      });
    }
  };

  // ============================================
  // 4. LOADING STATES
  // ============================================
  const loading = {
    show(element, type = 'spinner') {
      if (type === 'skeleton') {
        element.innerHTML = this.getSkeletonHTML();
      } else {
        element.innerHTML = '<div class="flex items-center justify-center p-8"><span class="iconify w-8 h-8 animate-spin text-indigo-600" data-icon="mdi:loading"></span></div>';
      }
    },
    
    getSkeletonHTML() {
      return `
        <div class="animate-pulse space-y-4 p-4">
          <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
          <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded"></div>
          <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6"></div>
        </div>
      `;
    },
    
    showProgress(percent, element) {
      if (!element) return;
      element.innerHTML = `
        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
          <div class="bg-indigo-600 h-2 rounded-full transition-all duration-300" style="width: ${percent}%"></div>
        </div>
      `;
    }
  };

  // ============================================
  // 5. REAL-TIME UPDATES
  // ============================================
  const realtime = {
    intervals: {},
    
    startPolling(url, callback, interval = 5000) {
      const id = url;
      if (this.intervals[id]) {
        clearInterval(this.intervals[id]);
      }
      
      this.intervals[id] = setInterval(async () => {
        try {
          const res = await fetch(url);
          const data = await res.json();
          callback(data);
        } catch (e) {
          console.error('Polling error:', e);
        }
      }, interval);
    },
    
    stopPolling(url) {
      const id = url;
      if (this.intervals[id]) {
        clearInterval(this.intervals[id]);
        delete this.intervals[id];
      }
    }
  };

  // ============================================
  // 6. INITIALIZATION
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    darkMode.init();
    shortcuts.init();
    
    // Dark mode toggle shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        darkMode.toggle();
      }
    });
    
    // Expose to global scope
    window.darkMode = darkMode;
    window.searchFilter = searchFilter;
    window.loading = loading;
    window.realtime = realtime;
  });
})();


