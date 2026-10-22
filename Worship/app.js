// We import these for their side-effects (registering window functions)
import './auth.js';
import './bible.js';
import './editor.js';
import './presenter.js';

// Initialize SQL.js for the Bible Manager
window.onload = async function() {
     try {
        const config = { locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${filename}` };
        window.SQL = await initSqlJs(config);
        console.log("SQL Engine Loaded");
    } catch(e) { 
        console.error("SQL load failed", e); 
    }
    
    // Attempt session restore (Function defined in presenter.js)
    if (window.loadPrefs) window.loadPrefs();
};
