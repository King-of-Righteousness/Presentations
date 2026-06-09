// --- STATE ---
let bibles = {};
let currentBibleKey = null;
let bibleToolsExpanded = true;
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbybbQfXQjGFcskLmJsbwC-kwQBdd-TjGxgehTRQYhaclrJqWYb-xavp7PXv1PMKqdRH/exec";

// --- STATIC DATA ---
const STD_BOOKS = [
    "Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
    "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah","Esther",
    "Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel",
    "Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi",
    "Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians",
    "1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews","James",
    "1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"
];

// ==========================================
// --- NEW: PERMANENT LOCAL CACHE ENGINE ---
// ==========================================
const DB_NAME = "WorshipBibleDB";
const STORE_NAME = "bibles";

function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "name" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveBibleToLocalCache(bibleData) {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(bibleData);
    } catch(e) { console.error("Could not save to local cache", e); }
}

async function loadBiblesFromLocalCache() {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => {
            const results = request.result;
            if (results && results.length > 0) {
                results.forEach(b => bibles[b.name] = b);
                
                // Restore the last active Bible version
                const savedKey = localStorage.getItem("currentBibleKey");
                if (savedKey && bibles[savedKey]) {
                    currentBibleKey = savedKey;
                } else {
                    currentBibleKey = results[0].name;
                }
                
                updateBibleSelect();
                if(window.showNotification) window.showNotification(`📖 Restored ${results.length} Bible(s) from Cache`);
            }
        };
    } catch(e) { console.error("Could not load from local cache", e); }
}


// --- EXPOSE TO HTML ---
window.toggleBibleTools = () => {
    bibleToolsExpanded = !bibleToolsExpanded;
    const container = document.getElementById('bible-tools-container');
    const icon = document.getElementById('bible-toggle-icon');
    if (bibleToolsExpanded) { container.classList.remove('collapsed'); icon.innerText = "▼"; }
    else { container.classList.add('collapsed'); icon.innerText = "◀"; }
};

window.handleBibleUpload = async (input) => {
    const file = input.files[0];
    if(!file) return;
    window.showNotification("Parsing Bible...");
    try {
        let bibleData = null;
        if (file.name.toLowerCase().endsWith('.sqlite') || file.name.toLowerCase().endsWith('.db')) {
            const buffer = await readFileAsBuffer(file);
            bibleData = parseSQLiteBible(buffer, file.name);
        } else {
            const text = await readFileAsText(file);
            bibleData = parseXMLBible(text);
            bibleData.rawXML = text; 
        }
        if (bibleData && bibleData.name) {
            bibles[bibleData.name] = bibleData;
            currentBibleKey = bibleData.name;
            localStorage.setItem("currentBibleKey", currentBibleKey); // Save memory
            saveBibleToLocalCache(bibleData); // Save permanently to browser DB!
            
            updateBibleSelect();
            window.showNotification(`📖 Loaded: ${bibleData.name}`);
            document.getElementById('btnSaveBible').style.display = 'block';
        }
    } catch(e) { alert("Error: " + e.message); }
    input.value = "";
};

window.switchBibleVersion = (val) => { 
    currentBibleKey = val; 
    localStorage.setItem("currentBibleKey", val); // Remember selection
    populateBooks(); 
};

window.onBookChange = () => {
    const bIdx = document.getElementById('bible-book').value;
    const book = bibles[currentBibleKey].books[bIdx];
    const chapters = [...new Set(book.verses.map(v => v.chapter))].sort((a,b)=>a-b);
    const chSelect = document.getElementById('bible-chapter');
    chSelect.innerHTML = '<option value="" disabled selected>Ch</option>';
    chapters.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.innerText = c; chSelect.appendChild(opt);
    });
    document.getElementById('bible-verse').innerHTML = '<option value="" disabled selected>Vs</option>';
    chSelect.focus();
};

window.onChapterChange = () => {
    const bIdx = document.getElementById('bible-book').value;
    const chap = parseInt(document.getElementById('bible-chapter').value);
    loadBibleChapter(bIdx, chap);
    
    const book = bibles[currentBibleKey].books[bIdx];
    const verses = book.verses.filter(v => v.chapter === chap).sort((a,b)=>a.verse-b.verse);
    const vSelect = document.getElementById('bible-verse');
    vSelect.innerHTML = '<option value="" disabled selected>Vs</option>';
    verses.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.verse; opt.innerText = v.verse; vSelect.appendChild(opt);
    });
};

window.onVerseChange = () => {
    const vNum = parseInt(document.getElementById('bible-verse').value);
    const idx = window.currentSongData.parts.findIndex(p => p.name.includes(`:${vNum}`));
    if(idx !== -1) {
        const card = document.getElementById(`part-${idx}`);
        if(card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

window.handleBibleSearch = (input) => {
    const val = input.value.trim();
    const sugg = document.getElementById('bible-suggestions');
    if(!val || !currentBibleKey) { sugg.style.display = 'none'; return; }

    const refMatch = val.match(/^(\d?\s?[a-zA-Z]+)\s*(\d+)?(?::(\d+))?$/);
    sugg.innerHTML = '';
    const books = bibles[currentBibleKey].books;
    
    if (refMatch) {
        const bookQuery = refMatch[1].toLowerCase();
        const chapQuery = refMatch[2];
        const verseQuery = refMatch[3];
        const matches = books.filter(b => b.name.toLowerCase().includes(bookQuery));
        matches.forEach(m => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            let label = m.name;
            if(chapQuery) label += ` ${chapQuery}`;
            if(verseQuery) label += `:${verseQuery}`;
            div.innerText = label;
            div.onclick = () => {
                const bIdx = books.findIndex(b => b.name === m.name);
                document.getElementById('bible-book').value = bIdx;
                window.onBookChange(); 
                if(chapQuery) {
                    document.getElementById('bible-chapter').value = chapQuery;
                    window.onChapterChange();
                    if(verseQuery) {
                        setTimeout(() => {
                            document.getElementById('bible-verse').value = verseQuery;
                            window.onVerseChange();
                        }, 100);
                    }
                }
                sugg.style.display = 'none'; input.value = '';
            };
            sugg.appendChild(div);
        });
    }
    sugg.style.display = sugg.children.length > 0 ? 'block' : 'none';
};

window.fetchCloudBibles = async () => {
    window.showNotification("Fetching Cloud Library...");
    try {
        const res = await fetch(APPS_SCRIPT_URL + "?action=list&t=" + Date.now());
        const data = await res.json();
        if(data.files) {
            const bibleFiles = data.files.filter(f => f.name.startsWith("BIBLE_"));
            if(bibleFiles.length === 0) { alert("No Cloud Bibles found."); return; }
            let msg = "Select a Cloud Bible to Load:\n";
            bibleFiles.forEach((f, i) => msg += `[${i}] ${f.name.replace("BIBLE_", "")}\n`);
            const choice = prompt(msg);
            if(choice !== null) {
                const idx = parseInt(choice);
                if(bibleFiles[idx]) window.loadBibleFromDrive(bibleFiles[idx].id);
            }
        }
    } catch(e) { console.log("Cloud bible fetch error", e); }
};

window.loadBibleFromDrive = async (id) => {
    window.showNotification("Downloading Bible... ☁");
    try {
        const res = await fetch(APPS_SCRIPT_URL + "?action=getContent&id=" + id);
        const json = await res.json();
        if(json.ok && json.data) {
            let bibleData = null;
            if(typeof json.data === 'string' && json.data.trim().startsWith('<')) {
                bibleData = parseXMLBible(json.data);
                bibleData.rawXML = json.data;
            } else { bibleData = json.data; }

            if(bibleData && bibleData.name) {
                bibles[bibleData.name] = bibleData;
                currentBibleKey = bibleData.name;
                localStorage.setItem("currentBibleKey", currentBibleKey); // Save memory
                saveBibleToLocalCache(bibleData); // Save permanently to browser DB!
                
                updateBibleSelect();
                window.showNotification(`✅ Cloud Loaded: ${bibleData.name}`);
            }
        }
    } catch(e) { alert("Load failed: " + e.message); }
};

window.saveBibleToDrive = async () => {
     if(!currentBibleKey) return;
     window.showNotification("Uploading Bible to Drive... ☁");
     const data = bibles[currentBibleKey];
     let payloadData = data;
     let filename = `BIBLE_${data.name}`;
     if(data.rawXML) { payloadData = data.rawXML; filename += ".xml"; }
     const payload = { action: "save", name: filename, overwrite: true, data: payloadData };
     try {
        const response = await fetch(APPS_SCRIPT_URL + "?action=save", { method: "POST", body: JSON.stringify(payload) });
        const res = await response.json();
        if(res.ok) window.showNotification("✅ Bible Saved to Cloud!");
        else alert("Save failed");
    } catch(e) { alert("Error saving: " + e.message); }
};

// --- INTERNAL HELPERS ---
function updateBibleSelect() {
    const select = document.getElementById('bible-version-select');
    select.innerHTML = '<option value="" disabled>Select Version...</option>';
    Object.keys(bibles).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.innerText = name; select.appendChild(opt);
    });
    select.value = currentBibleKey;
    document.getElementById('bible-search').disabled = false;
    populateBooks();
}

function populateBooks() {
    if(!currentBibleKey || !bibles[currentBibleKey]) return;
    const books = bibles[currentBibleKey].books;
    const select = document.getElementById('bible-book');
    select.innerHTML = '<option value="" disabled selected>Book</option>';
    books.forEach((b, idx) => {
        const opt = document.createElement('option');
        opt.value = idx; opt.innerText = b.name; select.appendChild(opt);
    });
    document.getElementById('bible-chapter').innerHTML = '<option value="" disabled selected>Ch</option>';
    document.getElementById('bible-verse').innerHTML = '<option value="" disabled selected>Vs</option>';
}

function loadBibleChapter(bookIdx, chap) {
    const data = bibles[currentBibleKey];
    const book = data.books[bookIdx];
    const verses = book.verses.filter(v => v.chapter === chap).sort((a,b) => a.verse - b.verse);
    
    // UPDATE GLOBAL 
    window.currentSongData = {
        type: 'song',
        title: `${book.name} ${chap} (${currentBibleKey})`,
        parts: verses.map(v => ({ name: `${book.name} ${chap}:${v.verse}`, lyrics: v.text }))
    };
    document.getElementById('current-song-title').innerText = window.currentSongData.title;
    if(window.renderLyricsGrid) window.renderLyricsGrid(); 
}

// --- FILE READERS ---
function readFileAsText(file) { 
    return new Promise(r => { 
        const rd = new FileReader(); 
        rd.onload = e => r(e.target.result); 
        rd.readAsText(file); 
    }); 
}

function readFileAsBuffer(file) { 
    return new Promise(r => { 
        const rd = new FileReader(); 
        rd.onload = e => r(e.target.result); 
        rd.readAsArrayBuffer(file); 
    }); 
}

// --- PARSERS ---

// XML PARSER
function parseXMLBible(xmlString) { 
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    if (xmlDoc.querySelector("parsererror")) throw new Error("Invalid XML");
    
    let name = xmlDoc.documentElement.getAttribute('translation') || "XML Bible";
    let books = [];
    
    xmlDoc.querySelectorAll('book').forEach(b => {
        let bNum = parseInt(b.getAttribute('number'));
        let bName = STD_BOOKS[bNum - 1] || "Book " + bNum;
        let verses = [];
        
        b.querySelectorAll('chapter').forEach(c => {
            let cNum = parseInt(c.getAttribute('number'));
            c.querySelectorAll('verse').forEach(v => {
                verses.push({ chapter: cNum, verse: parseInt(v.getAttribute('number')), text: v.textContent });
            });
        });
        
        if(verses.length) books.push({ name: bName, verses: verses });
    });
    return { name, books };
}

// SQLITE PARSER
function parseSQLiteBible(buffer, filename) { 
    if (!window.SQL) throw new Error("SQL Engine not ready");
    const dbSql = new window.SQL.Database(new Uint8Array(buffer));
    let books = [];
    let bookMap = {};
    
    STD_BOOKS.forEach((b,i) => bookMap[i+1] = b);
    
    let res = dbSql.exec("SELECT book_id, chapter, verse, text FROM verse");
    if (!res.length) res = dbSql.exec("SELECT book_id, chapter, verse, text FROM verses");
    
    if (res.length > 0) {
        let tempBooks = {};
        res[0].values.forEach(row => {
            let bName = bookMap[row[0]] || "Book " + row[0];
            if(!tempBooks[bName]) tempBooks[bName] = [];
            let txt = row[3].replace(/<[^>]*>/g, '');
            tempBooks[bName].push({ chapter: row[1], verse: row[2], text: txt });
        });
        for(let k in tempBooks) books.push({ name: k, verses: tempBooks[k] });
    }
    dbSql.close();
    return { name: filename.replace('.sqlite',''), books: books };
}

// ==========================================
// --- INITIALIZE CACHE ON SCRIPT LOAD ---
// ==========================================
// This automatically runs when the page is loaded/refreshed
loadBiblesFromLocalCache();