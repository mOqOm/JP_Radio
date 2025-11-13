/**
 * Radiko Stations 表示用スクリプト
 * API からデータを取得してテーブル・グリッド・番組表に表示
 */

// グローバル状態管理
const state = {
  currentTab: 'stations',
  stationsData: null,
  programData: null,
  programsData: null
};

/**
 * ページ初期化処理
 */
function initializePage() {
  setupTabNavigation();
  setupProgramsControls();
  loadStations();
}

/**
 * タブナビゲーションのセットアップ
 */
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll( '.tab-button' );

  tabButtons.forEach( button => {
    button.addEventListener( 'click', () => {
      const tabName = button.getAttribute( 'data-tab' );
      switchTab( tabName );
    } );
  } );
}

/**
 * 番組表コントロールのセットアップ
 */
function setupProgramsControls() {
  // 今日ボタン
  document.getElementById( 'todayButton' ).addEventListener( 'click', () => {
    document.getElementById( 'dateInput' ).value = getCurrentDate();
  } );

  // 番組表を表示ボタン
  document.getElementById( 'loadProgramsButton' ).addEventListener( 'click', () => {
    loadProgramsList();
  } );

  // 日付の初期値を今日に設定
  document.getElementById( 'dateInput' ).value = getCurrentDate();
}

/**
 * 現在の日付を YYYY-MM-DD 形式で取得
 * @returns {string} 現在の日付
 */
function getCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String( now.getMonth() + 1 ).padStart( 2, '0' );
  const day = String( now.getDate() ).padStart( 2, '0' );
  return `${ year }-${ month }-${ day }`;
}

/**
 * タブ切り替え処理
 * @param {string} tabName - 切り替え先のタブ名
 */
function switchTab( tabName ) {
  // ボタンのアクティブ状態を更新
  document.querySelectorAll( '.tab-button' ).forEach( btn => {
    btn.classList.remove( 'active' );
  } );
  document.querySelector( `[data-tab="${ tabName }"]` ).classList.add( 'active' );

  // コンテンツの表示切り替え
  document.querySelectorAll( '.tab-content' ).forEach( content => {
    content.classList.remove( 'active' );
  } );
  document.getElementById( `${ tabName }-tab` ).classList.add( 'active' );

  // データ読み込み
  state.currentTab = tabName;
  if ( tabName === 'stations' && !state.stationsData ) {
    loadStations();
  } else if ( tabName === 'with-program' && !state.programData ) {
    loadProgramData();
  } else if ( tabName === 'programs' && !state.stationsData ) {
    loadStations();
  }
}

/**
 * 放送局データを API から取得して表示
 */
async function loadStations() {
  const loading = document.getElementById( 'loading' );
  const error = document.getElementById( 'error' );
  const table = document.getElementById( 'stationsTable' );
  const tbody = document.getElementById( 'stationsBody' );

  try {
    showLoading( true );
    hideError();

    const response = await fetch( window.API_ENDPOINTS.stations );

    if ( !response.ok ) {
      throw new Error( `HTTP error! status: ${ response.status }` );
    }

    const data = await response.json();
    const stations = data.stations || [];
    state.stationsData = stations;

    showLoading( false );

    if ( stations.length === 0 ) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">No stations available</td></tr>';
    } else {
      tbody.innerHTML = stations.map( station => `
                <tr>
                    <td>${ escapeHtml( station.stationId ) }</td>
                    <td>${ escapeHtml( station.name ) }</td>
                    <td>${ escapeHtml( station.region ) }</td>
                    <td>${ escapeHtml( station.area ) }</td>
                </tr>
            `).join( '' );
    }

    table.style.display = 'table';

    // 番組表タブ用の放送局セレクトボックスを更新
    populateStationSelect( stations );

  } catch ( err ) {
    showLoading( false );
    showError( `Failed to load stations: ${ err.message }` );
    console.error( 'Error loading stations:', err );
  }
}

/**
 * 放送局セレクトボックスにオプションを追加
 * @param {Array} stations - 放送局データの配列
 */
function populateStationSelect( stations ) {
  const select = document.getElementById( 'stationSelect' );

  // 既存のオプション（"選択してください"）以外をクリア
  select.innerHTML = '<option value="">選択してください</option>';

  // 地域でグループ化
  const grouped = {};
  stations.forEach( station => {
    const region = station.region || 'その他';
    if ( !grouped[ region ] ) {
      grouped[ region ] = [];
    }
    grouped[ region ].push( station );
  } );

  // 地域ごとに optgroup を作成
  Object.keys( grouped ).sort().forEach( region => {
    const optgroup = document.createElement( 'optgroup' );
    optgroup.label = region;

    grouped[ region ].forEach( station => {
      const option = document.createElement( 'option' );
      option.value = station.stationId;
      option.textContent = station.name;
      optgroup.appendChild( option );
    } );

    select.appendChild( optgroup );
  } );
}

/**
 * 現在の番組データを API から取得して表示
 */
async function loadProgramData() {
  const loading = document.getElementById( 'loading' );
  const error = document.getElementById( 'error' );
  const programGrid = document.getElementById( 'programGrid' );

  try {
    showLoading( true );
    hideError();

    const response = await fetch( window.API_ENDPOINTS.withProgram );

    if ( !response.ok ) {
      throw new Error( `HTTP error! status: ${ response.status }` );
    }

    const data = await response.json();
    const stations = data.stations || [];
    state.programData = stations;

    showLoading( false );

    if ( stations.length === 0 ) {
      programGrid.innerHTML = '<div class="no-data">No program data available</div>';
    } else {
      programGrid.innerHTML = stations.map( station => createProgramCard( station ) ).join( '' );
    }

  } catch ( err ) {
    showLoading( false );
    showError( `Failed to load program data: ${ err.message }` );
    console.error( 'Error loading program data:', err );
  }
}

/**
 * 番組表データを API から取得して表示
 */
async function loadProgramsList() {
  const stationSelect = document.getElementById( 'stationSelect' );
  const dateInput = document.getElementById( 'dateInput' );
  const programsList = document.getElementById( 'programsList' );
  const loadButton = document.getElementById( 'loadProgramsButton' );

  const stationId = stationSelect.value;
  const date = dateInput.value;

  if ( !stationId ) {
    showError( '放送局を選択してください' );
    return;
  }

  if ( !date ) {
    showError( '日付を選択してください' );
    return;
  }

  try {
    showLoading( true );
    hideError();
    loadButton.disabled = true;

    // yyyy-MM-DD から yyyyMMdd に変換
    const dateParam = date.replace( /-/g, '' );
    const url = window.API_ENDPOINTS.programs.replace( ':stationId', stationId ) + `?date=${ dateParam }`;

    const response = await fetch( url );

    if ( !response.ok ) {
      throw new Error( `HTTP error! status: ${ response.status }` );
    }

    const data = await response.json();
    const programs = data.programs || [];
    state.programsData = { stationId, date: dateParam, programs };

    showLoading( false );
    loadButton.disabled = false;

    if ( programs.length === 0 ) {
      programsList.innerHTML = '<div class="no-data">番組データがありません</div>';
    } else {
      programsList.innerHTML = programs.map( program => createProgramItem( program ) ).join( '' );
    }

  } catch ( err ) {
    showLoading( false );
    loadButton.disabled = false;
    showError( `Failed to load programs: ${ err.message }` );
    console.error( 'Error loading programs:', err );
  }
}

/**
 * 番組カードの HTML を生成
 * @param {Object} station - 放送局データ
 * @returns {string} カードの HTML
 */
function createProgramCard( station ) {
  const program = station.program;

  const programContent = program ? `
        <div class="program-info">
            <div class="program-title">${ escapeHtml( program.title ) }</div>
            ${ program.pfm ? `<div class="program-pfm">${ escapeHtml( program.pfm ) }</div>` : '' }
            <div class="program-time">${ program.ft } - ${ program.to }</div>
        </div>
    ` : `
        <div class="program-info">
            <div class="no-program">番組情報がありません</div>
        </div>
    `;

  return `
        <div class="program-card">
            <div class="station-info">
                <div class="station-name">${ escapeHtml( station.name ) }</div>
                <div class="station-meta">
                    <span>${ escapeHtml( station.region ) }</span>
                    <span>${ escapeHtml( station.area ) }</span>
                </div>
            </div>
            ${ programContent }
        </div>
    `;
}

/**
 * 番組アイテムの HTML を生成
 * @param {Object} program - 番組データ
 * @returns {string} アイテムの HTML
 */
function createProgramItem( program ) {
  const status = getProgramStatus( program.ft, program.to );
  const duration = program.dur;

  return `
        <div class="program-item">
            <div class="program-item-header">
                <div class="program-item-time">
                    ${ getStatusBadge( status ) }
                    ${ program.ft } - ${ program.to }
                </div>
                <div class="program-item-title">${ escapeHtml( program.title ) }</div>
            </div>
            ${ program.pfm ? `<div class="program-item-pfm">${ escapeHtml( program.pfm ) }</div>` : '' }
            <div class="program-item-duration">${ duration }</div>
        </div>
    `;
}

/**
 * 番組のステータスを判定
 * @param {string} ftTimeStr - 開始時刻 (ISO 8601 または HH:mm)
 * @param {string} toTimeStr - 終了時刻 (ISO 8601 または HH:mm)
 * @returns {string} ステータス ('live', 'upcoming', 'timefree', 'expired')
 */
function getProgramStatus( ftTimeStr, toTimeStr ) {
  const now = new Date();
  // 検索した日付を取得
  const dateInput = document.getElementById( 'dateInput' );
  // yyyy-MM-DD から yyyyMMdd に変換
  const dateParam = dateInput.value.split( '-' );

  const year = dateParam[ 0 ];
  const month = dateParam[ 1 ];
  const day = dateParam[ 2 ];

  const ftDateTime = new Date( year, month - 1, day );
  const ftTimeSplit = ftTimeStr.split( ':' );
  const ftHour = parseInt( ftTimeSplit[ 0 ], 10 );
  // 5時以降の場合は翌日に設定
  if ( ftHour <= 5 ) {
    ftDateTime.setDate( ftDateTime.getDate() + 1 );
    ftDateTime.setHours( ftHour, parseInt( ftTimeSplit[ 1 ], 10 ), 0, 0 );
  }
  ftDateTime.setHours( ftHour, parseInt( ftTimeSplit[ 1 ], 10 ), 0, 0 );

  const toDateTime = new Date( year, month - 1, day );
  const toTimeSplit = toTimeStr.split( ':' );
  const toHour = parseInt( toTimeSplit[ 0 ], 10 );
  // 5時以降の場合は翌日に設定
  if ( toHour <= 5 ) {
    toDateTime.setDate( toDateTime.getDate() + 1 );
    toDateTime.setHours( toHour, parseInt( toTimeSplit[ 1 ], 10 ), 0, 0 );
  }
  toDateTime.setHours( toHour, parseInt( toTimeSplit[ 1 ], 10 ), 0, 0 );


  if ( now >= ftDateTime && now < toDateTime ) {
    return 'live';
  } else if ( now < ftDateTime ) {
    return 'upcoming';
  } else {
    // 終了後7日以内ならタイムフリー
    const diffDays = ( now - toDateTime ) / ( 1000 * 60 * 60 * 24 );
    return diffDays <= 7 ? 'timefree' : 'expired';
  }
}

/**
 * ステータスバッジの HTML を生成
 * @param {string} status - ステータス
 * @returns {string} バッジの HTML
 */
function getStatusBadge( status ) {
  const badges = {
    'live': '<span class="status-badge status-live">LIVE</span>',
    'upcoming': '<span class="status-badge status-upcoming">予定</span>',
    'timefree': '<span class="status-badge status-timefree">TimeFree</span>',
    'expired': '<span class="status-badge status-expired">終了</span>'
  };
  return badges[ status ] || '';
}

/**
 * 番組時刻文字列を Date オブジェクトに変換
 * ISO 8601 形式 (YYYY-MM-DDTHH:mm:ss+09:00) または HH:mm 形式をサポート
 * @param {string} timeStr - 時刻文字列
 * @returns {Date} Date オブジェクト
 */
function parseProgramTime( timeStr ) {
  if ( !timeStr ) return new Date();

  // ✅ ISO 8601 形式の場合 (例: "2025-11-13T03:00:00+09:00")
  if ( timeStr.includes( 'T' ) || timeStr.includes( '-' ) ) {
    const date = new Date( timeStr );
    return isNaN( date.getTime() ) ? new Date() : date;
  }

  // ✅ HH:mm 形式の場合（後方互換性）
  if ( timeStr.length === 5 && timeStr.includes( ':' ) ) {
    let hour = parseInt( timeStr.substring( 0, 2 ), 10 );
    const minute = parseInt( timeStr.substring( 3, 5 ), 10 );

    const now = new Date();
    if ( hour >= 24 ) {
      const nextDay = new Date( now );
      nextDay.setDate( nextDay.getDate() + 1 );
      nextDay.setHours( hour - 24, minute, 0, 0 );
      return nextDay;
    }

    now.setHours( hour, minute, 0, 0 );
    return now;
  }

  return new Date();
}


/**
 * 番組時刻を HH:mm 形式でフォーマット
 * @param {string} ftDateTimeStr - 開始時刻 (yyyy/MM/dd HH:mm:ss)
 * @param {string} toDateTimeStr - 終了時刻 (yyyy/MM/dd HH:mm:ss)
 * @returns {string} フォーマットされた時刻文字列 "HH:mm - HH:mm"
 */
function formatProgramTime( ftDateTimeStr, toDateTimeStr ) {
  if ( !ftDateTimeStr || !toDateTimeStr ) return '';

  const formatTime = ( timeStr ) => {
    const year = timeStr.split( '/' )[ 0 ];
    const month = timeStr.split( '/' )[ 1 ];
    const day = timeStr.split( '/' )[ 2 ].split( ' ' )[ 0 ];
    const hour = timeStr.split( ' ' )[ 1 ].split( ':' )[ 0 ];
    const minute = timeStr.split( ' ' )[ 1 ].split( ':' )[ 1 ];
    const second = timeStr.split( ' ' )[ 1 ].split( ':' )[ 2 ];

    return `${ hour }:${ minute }`;
  };

  return `${ formatTime( ftDateTimeStr ) } - ${ formatTime( toDateTimeStr ) }`;
}

/**
 * ローディング表示の切り替え
 * @param {boolean} show - 表示するかどうか
 */
function showLoading( show ) {
  const loading = document.getElementById( 'loading' );
  loading.style.display = show ? 'block' : 'none';
}

/**
 * エラー表示
 * @param {string} message - エラーメッセージ
 */
function showError( message ) {
  const error = document.getElementById( 'error' );
  error.textContent = message;
  error.style.display = 'block';
}

/**
 * エラー非表示
 */
function hideError() {
  const error = document.getElementById( 'error' );
  error.style.display = 'none';
}

/**
 * HTML エスケープ処理
 * XSS 攻撃を防ぐため、特殊文字をエスケープ
 * @param {string} text - エスケープする文字列
 * @returns {string} エスケープされた文字列
 */
function escapeHtml( text ) {
  if ( !text ) return '';
  const div = document.createElement( 'div' );
  div.textContent = text;
  return div.innerHTML;
}

// ページ読み込み時に実行
document.addEventListener( 'DOMContentLoaded', initializePage );