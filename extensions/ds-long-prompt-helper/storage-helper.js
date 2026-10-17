/**
 * Sellify™ AI Connector - Storage Helper
 * 
 * This helper script allows external tools, bookmarklets, and scripts to send
 * prompts to AI platforms via chrome.storage, bypassing URL length limitations.
 * 
 * Usage:
 * 1. Include this script in your page/bookmarklet
 * 2. Call sendPromptToAI(platform, promptText)
 * 3. The extension will inject the prompt when the AI platform loads
 */

(function() {
    'use strict';

    /**
     * Sends a prompt to an AI platform via chrome.storage
     * @param {string} platform - Target platform: 'gemini', 'chatgpt', 'claude', 'perplexity', 'manus'
     * @param {string} promptText - The prompt to send
     * @param {boolean} autoOpen - Whether to automatically open the platform (default: true)
     * @returns {Promise<void>}
     */
    window.sendPromptToAI = async function(platform, promptText, autoOpen = true) {
        // Validate inputs
        if (!platform || !promptText) {
            throw new Error('Platform and promptText are required');
        }

        const validPlatforms = ['gemini', 'chatgpt', 'claude', 'perplexity', 'manus'];
        if (!validPlatforms.includes(platform)) {
            throw new Error('Invalid platform. Must be one of: ' + validPlatforms.join(', '));
        }

        // Platform URLs
        const platformUrls = {
            gemini: 'https://gemini.google.com/',
            chatgpt: 'https://chat.openai.com/',
            claude: 'https://claude.ai/',
            perplexity: 'https://www.perplexity.ai/',
            manus: 'https://manus.im/app'
        };

        try {
            // Store prompt data
            const promptData = {
                text: promptText,
                platform: platform,
                timestamp: Date.now()
            };

            // Use chrome.storage if available (extension context)
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                await new Promise((resolve, reject) => {
                    chrome.storage.local.set({ pendingPrompt: promptData }, () => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            console.log('[Sellify Storage Helper] Prompt stored (' + promptText.length + ' chars)');
                            resolve();
                        }
                    });
                });

                // Open platform if requested
                if (autoOpen) {
                    window.open(platformUrls[platform], '_blank');
                }
            } else {
                throw new Error('Chrome storage API not available. This helper requires the Sellify™ AI Connector extension to be installed.');
            }
        } catch (error) {
            console.error('[Sellify Storage Helper] Error:', error);
            throw error;
        }
    };

    /**
     * Bookmarklet-friendly version that copies to clipboard if storage fails
     * @param {string} platform - Target platform
     * @param {string} promptText - The prompt to send
     */
    window.sendPromptToAIWithFallback = async function(platform, promptText) {
        try {
            await window.sendPromptToAI(platform, promptText, true);
        } catch (error) {
            // Fallback: copy to clipboard and show instructions
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(promptText);
                alert(
                    'Sellify™ AI Connector:\n\n' +
                    'Prompt copied to clipboard (' + promptText.length + ' chars)!\n\n' +
                    'The extension is not available. Please:\n' +
                    '1. Install the Sellify™ AI Connector extension\n' +
                    '2. Or paste the prompt manually into ' + platform
                );
            } else {
                alert('Error: ' + error.message);
            }
        }
    };

    console.log('[Sellify Storage Helper] Loaded successfully');
})();

/**
 * EXAMPLE USAGE:
 * 
 * // Send a long prompt to Manus
 * const longPrompt = "Your very long prompt here...";
 * sendPromptToAI('manus', longPrompt);
 * 
 * // Send to ChatGPT without auto-opening
 * sendPromptToAI('chatgpt', 'Analyze this data...', false);
 * 
 * // Use fallback version (copies to clipboard if extension not available)
 * sendPromptToAIWithFallback('claude', 'Write a story...');
 * 
 * 
 * BOOKMARKLET VERSION:
 * 
 * javascript:(function(){var s=document.createElement('script');s.src='https://sellify.ph/storage-helper.js';document.body.appendChild(s);s.onload=function(){var p=prompt('Enter your prompt:');if(p){sendPromptToAI('manus',p);}};})();
 */
