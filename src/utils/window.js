const { BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('node:path');
const storage = require('../storage');

let mouseEventsIgnored = false;

const DEFAULT_MAIN_WINDOW_SIZE = { width: 1100, height: 800 };
const MIN_WINDOW_SIZE = { width: 700, height: 320 };

function getMoveIncrement(mainWindow) {
    try {
        const bounds = mainWindow.getBounds();
        const currentScreen = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
        const dim = Math.min(currentScreen.workAreaSize.width, currentScreen.workAreaSize.height);
        return Math.max(40, Math.floor(dim * 0.06));
    } catch {
        return 60;
    }
}

function moveWindow(mainWindow, dx, dy) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        if (!mainWindow.isVisible()) {
            mainWindow.showInactive();
        }

        const [currentX, currentY] = mainWindow.getPosition();
        mainWindow.setPosition(currentX + dx, currentY + dy);
    } catch (e) {
        console.error('Error moving window:', e);
    }
}

function createWindow(sendToRenderer, geminiSessionRef) {
    let windowWidth = DEFAULT_MAIN_WINDOW_SIZE.width;
    let windowHeight = DEFAULT_MAIN_WINDOW_SIZE.height;

    const shouldStartHidden = process.env.OPTIMUS_HIDDEN === '1' || process.env.CHEATING_DADDY_HIDDEN === '1';

    const mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: MIN_WINDOW_SIZE.width,
        minHeight: MIN_WINDOW_SIZE.height,
        resizable: true,
        frame: false,
        transparent: true,
        hasShadow: false,
        show: !shouldStartHidden,
        alwaysOnTop: process.platform === 'win32',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // TODO: change to true
            backgroundThrottling: false,
            enableBlinkFeatures: 'GetDisplayMedia',
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: '#00000000',
    });

    const { session, desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
                callback({ video: sources[0], audio: 'loopback' });
            });
        },
        { useSystemPicker: true }
    );

    mainWindow.setContentProtection(true);
    if (process.platform === 'win32') {
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }

    // Hide from Windows taskbar
    if (process.platform === 'win32') {
        try {
            mainWindow.setSkipTaskbar(true);
        } catch (error) {
            console.warn('Could not hide from taskbar:', error.message);
        }
    }

    // Hide from Mission Control on macOS
    if (process.platform === 'darwin') {
        try {
            mainWindow.setHiddenInMissionControl(true);
        } catch (error) {
            console.warn('Could not hide from Mission Control:', error.message);
        }
    }

    // Recover from unexpected renderer crashes instead of terminating the app
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('Render process gone:', details);
        if (details.reason !== 'clean-exit' && !mainWindow.isDestroyed()) {
            console.log('Reloading mainWindow after unexpected renderer crash...');
            mainWindow.reload();
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    // Initialize keybinds immediately and on dom-ready
    const initShortcuts = () => {
        const defaultKeybinds = getDefaultKeybinds();
        let keybinds = defaultKeybinds;

        // Load keybinds from storage
        const savedKeybinds = storage.getKeybinds();
        if (savedKeybinds) {
            keybinds = { ...defaultKeybinds, ...savedKeybinds };
        }

        updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef);
    };

    initShortcuts();

    mainWindow.webContents.once('dom-ready', () => {
        initShortcuts();
    });

    // In-window keyboard shortcuts fallback
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        const isMac = process.platform === 'darwin';
        const modKey = isMac ? input.meta : input.control;

        // Hide / Minimize: Ctrl+Shift+E / Cmd+Shift+E
        // Hides window into background — does NOT stop or quit the app
        if (modKey && input.shift && input.key.toLowerCase() === 'e') {
            event.preventDefault();
            console.log('In-window Ctrl+Shift+E triggered - minimizing/hiding window (app stays running)');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.hide();
            }
            return;
        }

        // Window movement fallback (supports Arrow keys, >, <, and both Ctrl and Alt modifiers)
        const isUp = input.key === 'ArrowUp' || input.key === 'Up' || input.code === 'ArrowUp';
        const isDown = input.key === 'ArrowDown' || input.key === 'Down' || input.code === 'ArrowDown';
        const isLeft = input.key === 'ArrowLeft' || input.key === 'Left' || input.code === 'ArrowLeft' || input.key === '<' || (input.shift && input.code === 'Comma');
        const isRight = input.key === 'ArrowRight' || input.key === 'Right' || input.code === 'ArrowRight' || input.key === '>' || (input.shift && input.code === 'Period');

        const isMoveModifier = modKey || input.alt;
        const inc = getMoveIncrement(mainWindow);

        if (isMoveModifier && isUp) {
            event.preventDefault();
            moveWindow(mainWindow, 0, -inc);
            return;
        }
        if (isMoveModifier && isDown) {
            event.preventDefault();
            moveWindow(mainWindow, 0, inc);
            return;
        }
        if (isMoveModifier && isLeft) {
            event.preventDefault();
            moveWindow(mainWindow, -inc, 0);
            return;
        }
        if (isMoveModifier && isRight) {
            event.preventDefault();
            moveWindow(mainWindow, inc, 0);
            return;
        }
    });

    setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef);

    return mainWindow;
}

function getDefaultKeybinds() {
    const isMac = process.platform === 'darwin';
    return {
        moveUp: isMac ? 'Alt+Up' : 'Ctrl+Up',
        moveDown: isMac ? 'Alt+Down' : 'Ctrl+Down',
        moveLeft: isMac ? 'Alt+Left' : 'Ctrl+Left',
        moveRight: isMac ? 'Alt+Right' : 'Ctrl+Right',
        toggleVisibility: isMac ? 'Cmd+\\' : 'Ctrl+\\',
        toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
        nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter',
        previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
        nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]',
        scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
        scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',
        emergencyErase: isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',
    };
}

function updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef) {
    const defaultKeybinds = getDefaultKeybinds();
    const effectiveKeybinds = { ...defaultKeybinds, ...(keybinds || {}) };
    console.log('Updating global shortcuts with:', effectiveKeybinds);

    // Unregister all existing shortcuts
    try {
        globalShortcut.unregisterAll();
    } catch (e) {
        console.warn('Error unregistering shortcuts:', e);
    }

    const isMac = process.platform === 'darwin';

    const movementActions = {
        moveUp: () => moveWindow(mainWindow, 0, -getMoveIncrement(mainWindow)),
        moveDown: () => moveWindow(mainWindow, 0, getMoveIncrement(mainWindow)),
        moveLeft: () => moveWindow(mainWindow, -getMoveIncrement(mainWindow), 0),
        moveRight: () => moveWindow(mainWindow, getMoveIncrement(mainWindow), 0),
    };

    // Register movement shortcuts: register primary keybind AND alternate modifier
    // This ensures movement works even if an active app (like a text editor) intercepts Ctrl+Arrow
    const moveKeyPairs = [
        { action: 'moveUp', primary: effectiveKeybinds.moveUp || (isMac ? 'Alt+Up' : 'Ctrl+Up'), alt: isMac ? 'Ctrl+Up' : 'Alt+Up' },
        { action: 'moveDown', primary: effectiveKeybinds.moveDown || (isMac ? 'Alt+Down' : 'Ctrl+Down'), alt: isMac ? 'Ctrl+Down' : 'Alt+Down' },
        { action: 'moveLeft', primary: effectiveKeybinds.moveLeft || (isMac ? 'Alt+Left' : 'Ctrl+Left'), alt: isMac ? 'Ctrl+Left' : 'Alt+Left' },
        { action: 'moveRight', primary: effectiveKeybinds.moveRight || (isMac ? 'Alt+Right' : 'Ctrl+Right'), alt: isMac ? 'Ctrl+Right' : 'Alt+Right' },
    ];

    moveKeyPairs.forEach(({ action, primary, alt }) => {
        const handler = movementActions[action];
        if (primary) {
            try {
                const ok = globalShortcut.register(primary, handler);
                console.log(`Registered ${action} (primary: ${primary}): success=${ok}`);
            } catch (error) {
                console.error(`Failed to register ${action} (${primary}):`, error);
            }
        }
        if (alt && alt !== primary) {
            try {
                const altOk = globalShortcut.register(alt, handler);
                console.log(`Registered ${action} (alt: ${alt}): success=${altOk}`);
            } catch (error) {
                // Ignore duplicate or failed alternate registrations
            }
        }
    });

    // Register toggle visibility shortcut
    if (effectiveKeybinds.toggleVisibility) {
        try {
            globalShortcut.register(effectiveKeybinds.toggleVisibility, () => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                if (mainWindow.isMinimized()) {
                    mainWindow.restore();
                    mainWindow.show();
                    return;
                }
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.showInactive();
                }
            });
            console.log(`Registered toggleVisibility: ${effectiveKeybinds.toggleVisibility}`);
        } catch (error) {
            console.error(`Failed to register toggleVisibility (${effectiveKeybinds.toggleVisibility}):`, error);
        }
    }

    // Register toggle click-through shortcut
    if (effectiveKeybinds.toggleClickThrough) {
        try {
            globalShortcut.register(effectiveKeybinds.toggleClickThrough, () => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                mouseEventsIgnored = !mouseEventsIgnored;
                if (mouseEventsIgnored) {
                    mainWindow.setIgnoreMouseEvents(true, { forward: true });
                    console.log('Mouse events ignored');
                } else {
                    mainWindow.setIgnoreMouseEvents(false);
                    console.log('Mouse events enabled');
                }
                mainWindow.webContents.send('click-through-toggled', mouseEventsIgnored);
            });
            console.log(`Registered toggleClickThrough: ${effectiveKeybinds.toggleClickThrough}`);
        } catch (error) {
            console.error(`Failed to register toggleClickThrough (${effectiveKeybinds.toggleClickThrough}):`, error);
        }
    }

    // Register next step shortcut (either starts session or takes screenshot based on view)
    if (effectiveKeybinds.nextStep) {
        try {
            globalShortcut.register(effectiveKeybinds.nextStep, async () => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                console.log('Next step shortcut triggered');
                try {
                    const isMac = process.platform === 'darwin';
                    const shortcutKey = isMac ? 'cmd+enter' : 'ctrl+enter';

                    mainWindow.webContents.executeJavaScript(`
                        if (typeof cheatingDaddy !== 'undefined' && typeof cheatingDaddy.handleShortcut === 'function') {
                            cheatingDaddy.handleShortcut('${shortcutKey}');
                        }
                    `);
                } catch (error) {
                    console.error('Error handling next step shortcut:', error);
                }
            });
            console.log(`Registered nextStep: ${effectiveKeybinds.nextStep}`);
        } catch (error) {
            console.error(`Failed to register nextStep (${effectiveKeybinds.nextStep}):`, error);
        }
    }

    // Register previous response shortcut
    if (effectiveKeybinds.previousResponse) {
        try {
            globalShortcut.register(effectiveKeybinds.previousResponse, () => {
                console.log('Previous response shortcut triggered');
                sendToRenderer('navigate-previous-response');
            });
            console.log(`Registered previousResponse: ${effectiveKeybinds.previousResponse}`);
        } catch (error) {
            console.error(`Failed to register previousResponse (${effectiveKeybinds.previousResponse}):`, error);
        }
    }

    // Register next response shortcut
    if (effectiveKeybinds.nextResponse) {
        try {
            globalShortcut.register(effectiveKeybinds.nextResponse, () => {
                console.log('Next response shortcut triggered');
                sendToRenderer('navigate-next-response');
            });
            console.log(`Registered nextResponse: ${effectiveKeybinds.nextResponse}`);
        } catch (error) {
            console.error(`Failed to register nextResponse (${effectiveKeybinds.nextResponse}):`, error);
        }
    }

    // Register scroll up shortcut
    if (effectiveKeybinds.scrollUp) {
        try {
            globalShortcut.register(effectiveKeybinds.scrollUp, () => {
                console.log('Scroll up shortcut triggered');
                sendToRenderer('scroll-response-up');
            });
            console.log(`Registered scrollUp: ${effectiveKeybinds.scrollUp}`);
        } catch (error) {
            console.error(`Failed to register scrollUp (${effectiveKeybinds.scrollUp}):`, error);
        }
    }

    // Register scroll down shortcut
    if (effectiveKeybinds.scrollDown) {
        try {
            globalShortcut.register(effectiveKeybinds.scrollDown, () => {
                console.log('Scroll down shortcut triggered');
                sendToRenderer('scroll-response-down');
            });
            console.log(`Registered scrollDown: ${effectiveKeybinds.scrollDown}`);
        } catch (error) {
            console.error(`Failed to register scrollDown (${effectiveKeybinds.scrollDown}):`, error);
        }
    }

    // Register hide/minimize shortcut: Ctrl+Shift+E
    // Hides window into background — does NOT stop or quit the app
    if (effectiveKeybinds.emergencyErase) {
        try {
            globalShortcut.register(effectiveKeybinds.emergencyErase, () => {
                console.log('Ctrl+Shift+E triggered - minimizing/hiding window (not stopping)');
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.hide();
                }
            });
            console.log(`Registered hide/minimize shortcut: ${effectiveKeybinds.emergencyErase}`);
        } catch (error) {
            console.error(`Failed to register emergencyErase (${effectiveKeybinds.emergencyErase}):`, error);
        }
    }

    // Global shortcut to pop up the app anytime: Ctrl+Alt+D
    try {
        globalShortcut.register('Ctrl+Alt+D', () => {
            console.log('Ctrl+Alt+D triggered - popping up window');
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) {
                    mainWindow.restore();
                }
                mainWindow.show();
                mainWindow.focus();
            }
        });
        console.log('Registered pop-up shortcut: Ctrl+Alt+D');
    } catch (error) {
        console.error('Failed to register Ctrl+Alt+D pop-up shortcut:', error);
    }
}

function setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef) {
    ipcMain.on('view-changed', (event, view) => {
        if (!mainWindow.isDestroyed()) {
            const isLiveMode = view === 'assistant';

            if (process.platform !== 'win32') {
                mainWindow.setAlwaysOnTop(isLiveMode);
                mainWindow.setVisibleOnAllWorkspaces(isLiveMode, { visibleOnFullScreen: isLiveMode });
            }

            if (!isLiveMode) {
                mainWindow.setIgnoreMouseEvents(false);
            }
        }
    });

    ipcMain.handle('window-minimize', () => {
        if (!mainWindow.isDestroyed()) {
            mainWindow.minimize();
        }
    });

    ipcMain.handle('toggle-window-visibility', async event => {
        try {
            if (mainWindow.isDestroyed()) {
                return { success: false, error: 'Window has been destroyed' };
            }

            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.showInactive();
            }
            return { success: true };
        } catch (error) {
            console.error('Error toggling window visibility:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    createWindow,
    getDefaultKeybinds,
    updateGlobalShortcuts,
    setupWindowIpcHandlers,
};
