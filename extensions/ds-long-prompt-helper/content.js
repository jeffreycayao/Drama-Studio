(function() {
    'use strict';

    // ============================================================================
    // PROMPT RETRIEVAL (URL + STORAGE)
    // ============================================================================
    
    /**
     * Reads prompt from URL (hash fragment or query params)
     * Hash fragments (#) bypass CloudFront/WAF - recommended for long prompts
     * @returns {string|null} Decoded prompt text or null if not found
     */
    function getPromptFromUrl() {
        let promptText = null;
        
        // Try hash fragment first (#prompt= or #q=) - bypasses server/CDN
        if (window.location.hash) {
            const hash = window.location.hash.substring(1); // Remove leading #
            const hashParams = new URLSearchParams(hash);
            promptText = hashParams.get('prompt') || hashParams.get('q');
            
            if (promptText && promptText.trim() !== '') {
                console.log('[Sellify Connector] Reading from hash fragment (bypasses CDN)');
                return promptText;
            }
        }
        
        // Fallback to query params (?prompt= or ?q=)
        const params = new URLSearchParams(window.location.search);
        promptText = params.get('prompt') || params.get('q');
        
        if (!promptText || promptText.trim() === '') {
            return null;
        }
        
        return promptText;
    }

    /**
     * Reads prompt from chrome.storage (for long prompts that exceed URL limits)
     * @returns {Promise<string|null>} Prompt text from storage or null
     */
    async function getPromptFromStorage() {
        return new Promise((resolve) => {
            if (!chrome.storage || !chrome.storage.local) {
                resolve(null);
                return;
            }

            chrome.storage.local.get(['pendingPrompt'], (result) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Sellify Connector] Storage read error:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }

                const promptData = result.pendingPrompt;
                if (!promptData || !promptData.text) {
                    resolve(null);
                    return;
                }

                // Check if prompt is for current platform
                const currentPlatform = detectPlatform();
                if (promptData.platform && promptData.platform !== currentPlatform) {
                    resolve(null);
                    return;
                }

                // Check if prompt hasn't expired (5 minutes)
                const now = Date.now();
                if (promptData.timestamp && (now - promptData.timestamp) > 300000) {
                    console.warn('[Sellify Connector] Stored prompt expired');
                    chrome.storage.local.remove(['pendingPrompt']);
                    resolve(null);
                    return;
                }

                console.log('[Sellify Connector] Retrieved prompt from storage (' + promptData.text.length + ' chars)');
                resolve(promptData.text);
            });
        });
    }

    /**
     * Clears the pending prompt from storage after successful injection
     */
    function clearStoredPrompt() {
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove(['pendingPrompt'], () => {
                console.log('[Sellify Connector] Cleared stored prompt');
            });
        }
    }

    // ============================================================================
    // PLATFORM DETECTION
    // ============================================================================
    
    /**
     * Detects which AI platform is currently open
     * @returns {'gemini'|'chatgpt'|'claude'|'perplexity'|'manus'|'grok'|'unknown'}
     */
    function detectPlatform() {
        const hostname = window.location.hostname;
        
        if (hostname.includes('gemini.google.com')) return 'gemini';
        if (hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com')) return 'chatgpt';
        if (hostname.includes('claude.ai')) return 'claude';
        if (hostname.includes('perplexity.ai')) return 'perplexity';
        if (hostname.includes('manus.im')) return 'manus';
        if (hostname.includes('grok.com')) return 'grok';
        
        return 'unknown';
    }

    // ============================================================================
    // SELECTOR REGISTRY
    // ============================================================================
    
    /**
     * Platform-specific CSS selectors for input elements
     * Ordered from most specific to most generic
     */
    const PLATFORM_SELECTORS = {
        gemini: [
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"].ql-editor',
            'div[contenteditable="true"]'
        ],
        chatgpt: [
            'textarea#prompt-textarea',
            'textarea[placeholder*="Message"]',
            'div[contenteditable="true"]'
        ],
        claude: [
            'div[contenteditable="true"][data-testid]',
            'div[contenteditable="true"].ProseMirror',
            'div[contenteditable="true"][placeholder]',
            'div[contenteditable="true"]'
        ],
        perplexity: [
            'textarea[placeholder*="Ask"]',
            'textarea',
            'div[contenteditable="true"]'
        ],
        manus: [
            'textarea[placeholder*="What"]',
            'textarea[placeholder*="can"]',
            'textarea',
            'div[contenteditable="true"]'
        ],
        grok: [
            'textarea[placeholder*="Ask"]',
            'textarea[placeholder*="Grok"]',
            'textarea',
            'div[contenteditable="true"]'
        ]
    };

    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    // Detect platform first
    const platform = detectPlatform();
    console.log('[Sellify Connector] platform=' + platform);
    
    // Exit if platform is unknown
    if (platform === 'unknown') {
        console.warn('[Sellify Connector] Unknown platform, extension will not run');
        return;
    }

    // Skip Perplexity — it natively handles ?q= parameter, no injection needed
    if (platform === 'perplexity') {
        console.log('[Sellify Connector] Perplexity handles ?q= natively, skipping injection');
        return;
    }

    // Main initialization function
    async function initialize() {
        // Try storage first (for long prompts), then fall back to URL
        let promptText = await getPromptFromStorage();
        let source = 'storage';
        let isHashFragment = false;
        
        if (!promptText) {
            // Check if using hash fragment
            isHashFragment = window.location.hash && window.location.hash.length > 1;
            promptText = getPromptFromUrl();
            source = isHashFragment ? 'hash' : 'url';
        }
        
        // Exit early if no prompt from either source
        if (!promptText) return;
        
        console.log('[Sellify Connector] Prompt source: ' + source + ' (' + promptText.length + ' chars)');
        
        // URL length warning (only for query params, not hash fragments)
        if (source === 'url' && promptText.length > 2000) {
            console.warn('[Sellify Connector] Long query param prompt (' + promptText.length + ' chars) - consider using hash fragment (#) or storage API');
        }
        
        // Hash fragments can handle any length (not sent to server)
        if (source === 'hash' && promptText.length > 10000) {
            console.log('[Sellify Connector] Large hash fragment (' + promptText.length + ' chars) - no server limits!');
        }
        
        return promptText;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function textToHtml(text) {
        // Escape HTML entities first, then convert line breaks to <br>
        return escapeHtml(text).replace(/\n/g, '<br>');
    }

    // ============================================================================
    // INPUT TYPE DETECTION
    // ============================================================================
    
    /**
     * Determines if element is a textarea or contenteditable
     * @param {HTMLElement} element
     * @returns {'textarea'|'contenteditable'}
     */
    function getInputType(element) {
        return element.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'contenteditable';
    }

    // ============================================================================
    // CONTENTEDITABLE HELPERS
    // ============================================================================
    
    function setCursorToEnd(element) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false); // false = collapse to end
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function simulateContentEditableInput(element, text) {
        // Focus the element
        element.focus();

        // Clear existing content
        element.innerHTML = '';

        // Try execCommand first — this triggers React/framework native input handlers
        // Unlike innerHTML, execCommand goes through the browser's editing pipeline
        // which React's contenteditable integration actually listens to
        let execSuccess = false;
        try {
            // Select all existing content (if any)
            document.execCommand('selectAll', false, null);
            // Insert text via native command — React picks this up
            execSuccess = document.execCommand('insertText', false, text);
        } catch (e) {
            console.warn('[Sellify Connector] execCommand failed, falling back to innerHTML:', e);
        }

        // Fallback: if execCommand didn't work, use innerHTML + synthetic events
        if (!execSuccess) {
            element.innerHTML = textToHtml(text);

            // Move cursor to end
            setCursorToEnd(element);

            // Dispatch synthetic events as fallback
            element.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: text
            }));

            element.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: false,
                inputType: 'insertText',
                data: text
            }));

            try {
                const textEvent = document.createEvent('TextEvent');
                textEvent.initTextEvent('textInput', true, true, window, text);
                element.dispatchEvent(textEvent);
            } catch (e) {
                // TextEvent not supported in all browsers
            }

            element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            // execCommand worked — still move cursor to end
            setCursorToEnd(element);
            console.log('[Sellify Connector] Used execCommand (React-compatible injection)');
        }
    }

    // ============================================================================
    // UNIFIED INPUT INJECTION
    // ============================================================================
    
    /**
     * Fills input element with text using appropriate method
     * @param {HTMLElement} element - The input element
     * @param {string} text - The text to inject
     * @param {'textarea'|'contenteditable'} inputType - Type of input
     */
    function fillInput(element, text, inputType) {
        try {
            if (inputType === 'textarea') {
                // For textarea elements
                element.focus();
                element.value = text;
                
                // Dispatch events for React/Vue/etc.
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                // For contenteditable elements
                simulateContentEditableInput(element, text);
            }
        } catch (error) {
            console.error('[Sellify Connector] Error injecting text on platform=' + platform + ':', error);
            throw error;
        }
    }

    // ============================================================================
    // ELEMENT FINDER / POLLING
    // ============================================================================
    
    /**
     * Attempts to find the input element for the current platform
     * @returns {HTMLElement|null} The found input element or null
     */
    function findInputElement() {
        const selectors = PLATFORM_SELECTORS[platform];
        
        if (!selectors) {
            console.warn('[Sellify Connector] No selectors defined for platform=' + platform);
            return null;
        }

        // Try each selector in order
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                console.log('[Sellify Connector] Found input using selector: ' + selector);
                return element;
            }
        }

        return null;
    }

    /**
     * Main injection function - finds element and fills it
     * @param {string} promptText - The prompt text to inject
     * @param {string} source - Source of the prompt ('url' or 'storage')
     * @returns {boolean} True if successful, false otherwise
     */
    function injectPrompt(promptText, source) {
        const inputElement = findInputElement();

        if (inputElement) {
            const inputType = getInputType(inputElement);
            fillInput(inputElement, promptText, inputType);
            console.log('[Sellify Connector] Text injected successfully (' + promptText.length + ' chars, type=' + inputType + ', source=' + source + ')');
            
            // Clear storage if prompt came from storage
            if (source === 'storage') {
                clearStoredPrompt();
            }
            
            return true;
        }
        
        return false;
    }

    // ============================================================================
    // POLLING LOGIC
    // ============================================================================
    
    /**
     * Starts polling for input element and injects prompt when found
     * @param {string} promptText - The prompt to inject
     * @param {string} source - Source of the prompt ('url' or 'storage')
     */
    function startPolling(promptText, source) {
        let attempts = 0;
        const maxAttempts = 30; // 15 seconds max (increased for slow connections)

        const intervalId = setInterval(() => {
            attempts++;
            
            try {
                const success = injectPrompt(promptText, source);

                if (success || attempts >= maxAttempts) {
                    clearInterval(intervalId);
                    
                    if (!success) {
                        const selectors = PLATFORM_SELECTORS[platform];
                        console.error(
                            '[Sellify Connector] Could not find input element after ' + 
                            (maxAttempts * 500 / 1000) + 's on platform=' + platform + 
                            '. Tried selectors: ' + selectors.join(', ')
                        );
                    }
                }
            } catch (error) {
                clearInterval(intervalId);
                console.error('[Sellify Connector] Fatal error during injection:', error);
            }
        }, 500);
    }

    // Start the initialization process
    initialize().then((promptText) => {
        if (promptText) {
            const source = getPromptFromUrl() ? 'url' : 'storage';
            startPolling(promptText, source);
        }
    });
})();
