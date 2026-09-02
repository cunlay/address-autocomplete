/**
 * Framework-free address autocomplete widget.
 * Wraps a text <input> with a results dropdown, debounced fetch to the
 * server-side unified API, and keyboard navigation.
 *
 * Usage:
 *   const ac = new AddressAutocomplete('#address-input', {
 *     provider: 'auto', // or 'here' | 'mapbox' | 'locationiq' | 'photon'
 *     onSelect: (result) => console.log(result),
 *   });
 */
class AddressAutocomplete {
  constructor(input, options = {}) {
    this.input = typeof input === 'string' ? document.querySelector(input) : input;
    if (!this.input) throw new Error('AddressAutocomplete: input element not found');

    this.options = {
      apiBase: '/api',
      provider: 'auto',
      debounceMs: 250,
      minLength: 2,
      limit: 5,
      lat: null,
      lon: null,
      country: null,
      onSelect: null,
      ...options,
    };

    this.results = [];
    this.activeIndex = -1;
    this.debounceTimer = null;
    this.abortController = null;

    this._buildDom();
    this._bindEvents();
  }

  _buildDom() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'aac-wrapper';
    this.input.parentNode.insertBefore(this.wrapper, this.input);
    this.wrapper.appendChild(this.input);

    this.input.classList.add('aac-input');
    this.input.setAttribute('autocomplete', 'off');
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('aria-autocomplete', 'list');

    this.listEl = document.createElement('ul');
    this.listEl.className = 'aac-list';
    this.listEl.setAttribute('role', 'listbox');
    this.listEl.hidden = true;
    this.wrapper.appendChild(this.listEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'aac-status';
    this.statusEl.setAttribute('aria-live', 'polite');
    this.wrapper.appendChild(this.statusEl);
  }

  _bindEvents() {
    this.input.addEventListener('input', () => this._onInput());
    this.input.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.input.addEventListener('blur', () => {
      // Delay so a mousedown on a list item registers before we hide it.
      setTimeout(() => this._closeList(), 150);
    });
    document.addEventListener('click', (e) => {
      if (!this.wrapper.contains(e.target)) this._closeList();
    });
  }

  _onInput() {
    const query = this.input.value.trim();
    clearTimeout(this.debounceTimer);

    if (query.length < this.options.minLength) {
      this._closeList();
      return;
    }

    this.debounceTimer = setTimeout(() => this._fetchResults(query), this.options.debounceMs);
  }

  async _fetchResults(query) {
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    const { apiBase, provider, limit, lat, lon, country } = this.options;
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (lat != null) params.set('lat', String(lat));
    if (lon != null) params.set('lon', String(lon));
    if (country) params.set('country', country);

    const endpoint = provider === 'auto'
      ? `${apiBase}/autocomplete/auto?${params.toString()}`
      : `${apiBase}/autocomplete?provider=${encodeURIComponent(provider)}&${params.toString()}`;

    this.statusEl.textContent = 'Searching…';

    try {
      const res = await fetch(endpoint, { signal: this.abortController.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      this.results = data.results || [];
      this.statusEl.textContent = this.results.length
        ? `${this.results.length} result${this.results.length === 1 ? '' : 's'}${data.provider ? ` from ${data.provider}` : ''}${data.cached ? ' (cached)' : ''}${this._quotaSuffix(data.quota)}`
        : 'No results found';
      this._renderList();
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.statusEl.textContent = `Error: ${err.message}`;
      this._closeList();
    }
  }

  // Renders a compact "(1,234 left today)" style suffix once a provider's
  // free-tier usage gets low, so the person notices before it runs out.
  _quotaSuffix(quota) {
    if (!quota || !quota.metered) return '';
    const period = quota.window === 'day' ? 'today' : 'this month';
    if (quota.exhausted) return ` — ${quota.provider} quota used up, switching providers`;
    if (quota.remaining <= quota.limit * 0.1) return ` (${quota.remaining} left ${period})`;
    return '';
  }

  _renderList() {
    this.listEl.innerHTML = '';
    this.activeIndex = -1;

    if (this.results.length === 0) {
      this._closeList();
      return;
    }

    this.results.forEach((result, index) => {
      const li = document.createElement('li');
      li.className = 'aac-item';
      li.setAttribute('role', 'option');
      li.id = `aac-option-${index}`;
      li.textContent = result.label;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._selectResult(index);
      });
      li.addEventListener('mouseenter', () => this._setActive(index));
      this.listEl.appendChild(li);
    });

    this.listEl.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }

  _setActive(index) {
    const items = this.listEl.querySelectorAll('.aac-item');
    items.forEach((item) => item.classList.remove('aac-item-active'));
    if (index >= 0 && items[index]) {
      items[index].classList.add('aac-item-active');
      this.input.setAttribute('aria-activedescendant', items[index].id);
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
    this.activeIndex = index;
  }

  _onKeyDown(e) {
    if (this.listEl.hidden) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._setActive(Math.min(this.activeIndex + 1, this.results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._setActive(Math.max(this.activeIndex - 1, 0));
        break;
      case 'Enter':
        if (this.activeIndex >= 0) {
          e.preventDefault();
          this._selectResult(this.activeIndex);
        }
        break;
      case 'Escape':
        this._closeList();
        break;
      default:
        break;
    }
  }

  _selectResult(index) {
    const result = this.results[index];
    if (!result) return;
    this.input.value = result.label;
    this._closeList();
    if (typeof this.options.onSelect === 'function') {
      this.options.onSelect(result);
    }
  }

  _closeList() {
    this.listEl.hidden = true;
    this.listEl.innerHTML = '';
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.activeIndex = -1;
  }

  setProvider(provider) {
    this.options.provider = provider;
  }

  setLocation(lat, lon) {
    this.options.lat = lat;
    this.options.lon = lon;
  }

  destroy() {
    clearTimeout(this.debounceTimer);
    if (this.abortController) this.abortController.abort();
    this.listEl.remove();
    this.statusEl.remove();
  }
}

if (typeof window !== 'undefined') {
  window.AddressAutocomplete = AddressAutocomplete;
}
