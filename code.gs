// =====================================================================
// Code.gs - VERSI FINAL v5 (DENGAN FUNGSI VOTING YANG LENGKAP)
// =====================================================================

const JURY_SHEET_NAME = 'Skor Juri';
const VOTE_SHEET_NAME = 'Suara Favorit';

// =====================================================================
// FUNGSI UTAMA (doGet & doPost)
// =====================================================================

/**
 * Menangani permintaan GET dari semua halaman (leaderboard, winners, vote).
 * Menggunakan cache untuk kecepatan super dan pengecekan error yang aman.
 */
function doGet(e) {
  // PERBAIKAN KRUSIAL: Cek apakah e.parameter ada sebelum membacanya.
  const action = (e && e.parameter) ? e.parameter.action : undefined;
  const participant = (e && e.parameter) ? e.parameter.participant : undefined;

  const cache = CacheService.getScriptCache();
  let result;

  // Kunci cache yang unik berdasarkan action untuk mencegah data tertukar.
  const cacheKey = action || 'mainData';

  try {
    // Coba ambil dari cache dulu untuk mengurangi beban kerja.
    const cached = cache.get(cacheKey);
    if (cached != null) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }

    // Jika tidak ada di cache, hitung datanya.
    if (action === 'vote' && participant) {
      result = recordVote(participant);
    } else if (action === 'getVotes') {
      // PERBAIKAN: Tambahkan fungsi untuk mengambil data voting
      result = getVoteCounts();
    } else if (action === 'getJudgingProgress') {
      // Tambahkan fungsi untuk mengambil progress penilaian juri
      result = getJudgingProgress();
    } else {
      // Ini adalah panggilan data utama (untuk winners & leaderboard).
      result = getConsolidatedData();
    }

    const jsonResult = JSON.stringify(result);
    // Simpan hasil ke cache selama 1 menit (60 detik).
    cache.put(cacheKey, jsonResult, 60); 
    return ContentService.createTextOutput(jsonResult).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Menangani pengiriman form dari halaman juri.
 */
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(JURY_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    // Membuat baris baru sesuai urutan header di sheet.
    const newRow = headers.map(header => e.parameter[header] || '');
    sheet.appendRow(newRow);
    
    // Hapus cache setelah data baru masuk agar data di-refresh.
    CacheService.getScriptCache().removeAll(['mainData', 'getVotes']);

    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Penilaian berhasil dikirim." }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Gagal menyimpan data: " + error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =====================================================================
// FUNGSI PEMBANTU (TIDAK PERLU DIUBAH)
// =====================================================================

/**
 * Mengambil dan memproses SEMUA data skor juri dalam satu kali jalan.
 * Ini adalah fungsi paling efisien.
 */
function getConsolidatedData() {
  const jurySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(JURY_SHEET_NAME);
  // Pengecekan jika sheet tidak ada
  if (!jurySheet) {
    throw new Error(`Sheet dengan nama "${JURY_SHEET_NAME}" tidak ditemukan.`);
  }
  
  const juryData = jurySheet.getDataRange().getValues();
  
  const scores = [];
  if (juryData.length > 1) { // Pastikan ada data selain header
    const headers = juryData[0];
    const nameIndex = headers.indexOf('participant_name');
    const scoreIndex = headers.indexOf('total_score');
    const commentsIndex = headers.indexOf('comments');

    // Validasi header
    if (nameIndex === -1 || scoreIndex === -1) {
      throw new Error("Kolom 'participant_name' atau 'total_score' tidak ditemukan di sheet Skor Juri.");
    }

    for (let i = 1; i < juryData.length; i++) {
      const row = juryData[i];
      // Pengecekan data penting: pastikan nama dan skor tidak kosong.
      if (row[nameIndex] && row[scoreIndex] !== '') {
        scores.push({
          participant_name: row[nameIndex].toString().trim(), // trim() otomatis untuk keamanan data
          total_score: row[scoreIndex],
          comments: (commentsIndex > -1 && row[commentsIndex]) ? row[commentsIndex] : ''
        });
      }
    }
  }

  return {
    success: true,
    scores: scores,
    totalEntries: scores.length // Jumlah entri penilaian yang valid
  };
}

/**
 * PERBAIKAN: Fungsi baru untuk mengambil jumlah voting per peserta
 */
function getVoteCounts() {
  const voteSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VOTE_SHEET_NAME);
  if (!voteSheet) {
    throw new Error(`Sheet dengan nama "${VOTE_SHEET_NAME}" tidak ditemukan.`);
  }
  
  const voteData = voteSheet.getDataRange().getValues();
  const voteCounts = {};
  
  if (voteData.length > 1) { // Pastikan ada data selain header
    const headers = voteData[0];
    const nameIndex = headers.indexOf('participant_name');
    
    if (nameIndex === -1) {
      throw new Error("Kolom 'participant_name' tidak ditemukan di sheet Suara Favorit.");
    }
    
    // Hitung jumlah vote per peserta
    for (let i = 1; i < voteData.length; i++) {
      const row = voteData[i];
      if (row[nameIndex]) {
        const participantName = row[nameIndex].toString().trim();
        voteCounts[participantName] = (voteCounts[participantName] || 0) + 1;
      }
    }
  }
  
  return {
    success: true,
    votes: voteCounts,
    totalVotes: Object.values(voteCounts).reduce((sum, count) => sum + count, 0)
  };
}

/**
 * Mencatat suara dari halaman vote.
 */
function recordVote(participantName) {
  if (!participantName) {
    return { success: false, message: "Parameter tidak lengkap." };
  }
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VOTE_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet dengan nama "${VOTE_SHEET_NAME}" tidak ditemukan.`);
  }
  
  const timestamp = new Date();
  
  // Menggunakan nama kolom yang sudah Anda tentukan
  sheet.appendRow([participantName.trim(), "N/A", timestamp]); // ip_address diisi N/A

  // Hapus cache voting setelah vote baru masuk
  CacheService.getScriptCache().remove('getVotes');

  return { success: true, message: "Suara berhasil dicatat." };
}



// =====================================================================
// FUNGSI UNTUK MENDAPATKAN PROGRESS PENILAIAN JURI
// =====================================================================

/**
 * Mendapatkan progress penilaian juri untuk ditampilkan di halaman winners
 */
function getJudgingProgress() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const jurySheet = ss.getSheetByName(JURY_SHEET_NAME);
    
    if (!jurySheet) {
      return {
        success: false,
        message: 'Sheet Skor Juri tidak ditemukan',
        judgedParticipants: 0,
        completedJury: 0
      };
    }
    
    // Ambil semua data dari sheet juri
    const data = jurySheet.getDataRange().getValues();
    
    if (data.length < 2) {
      return {
        success: true,
        judgedParticipants: 0,
        completedJury: 0
      };
    }
    
    // Header ada di baris pertama
    const headers = data[0];
    const participantNameIndex = headers.indexOf('participant_name');
    const judgeNameIndex = headers.indexOf('judge_name');
    const totalScoreIndex = headers.indexOf('total_score');
    
    if (participantNameIndex === -1 || judgeNameIndex === -1 || totalScoreIndex === -1) {
      return {
        success: false,
        message: 'Kolom yang diperlukan tidak ditemukan',
        judgedParticipants: 0,
        completedJury: 0
      };
    }
    
    // Hitung peserta yang sudah dinilai dan juri yang sudah menyelesaikan
    const judgedParticipants = new Set();
    const juryProgress = {};
    
    // Daftar semua peserta (total 10 peserta)
    const allParticipants = [
      'Refadiva Matahari Farigia',
      'Ni Nyoman Sri Parwati', 
      'Anak Agung Made Dwi Antari',
      'Ni Putu Galuh Cahyani',
      'I Kadek Farrel Ananta Wijaya',
      'Mohammad Alfiannur Roziq',
      'I Gede Agus Candra Wira Ananta',
      'I Kadek Dylan Adi Dharma',
      'Odilia Putu Alani Sinulingga',
      'Putri Diva Maria Dewi'
    ];
    
    // Daftar semua juri (total 3 juri)
    const allJury = ['Juri 1', 'Juri 2', 'Juri 3'];
    
    // Inisialisasi progress juri
    allJury.forEach(jury => {
      juryProgress[jury] = new Set();
    });
    
    // Proses data penilaian
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const participantName = row[participantNameIndex];
      const judgeName = row[judgeNameIndex];
      const totalScore = row[totalScoreIndex];
      
      // Jika ada skor total, berarti peserta sudah dinilai
      if (participantName && judgeName && totalScore !== null && totalScore !== '') {
        judgedParticipants.add(participantName);
        
        if (juryProgress[judgeName]) {
          juryProgress[judgeName].add(participantName);
        }
      }
    }
    
    // Hitung berapa juri yang sudah menyelesaikan semua penilaian
    let completedJury = 0;
    allJury.forEach(jury => {
      if (juryProgress[jury] && juryProgress[jury].size === allParticipants.length) {
        completedJury++;
      }
    });
    
    return {
      success: true,
      judgedParticipants: judgedParticipants.size,
      completedJury: completedJury,
      totalParticipants: allParticipants.length,
      totalJury: allJury.length,
      juryDetails: Object.fromEntries(
        allJury.map(jury => [jury, juryProgress[jury] ? juryProgress[jury].size : 0])
      )
    };
    
  } catch (error) {
    console.error('Error in getJudgingProgress:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat mengambil data progress: ' + error.toString(),
      judgedParticipants: 0,
      completedJury: 0
    };
  }
}

