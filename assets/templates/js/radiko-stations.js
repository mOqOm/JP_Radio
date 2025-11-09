/**
 * Radiko Stations 表示用スクリプト
 * API からデータを取得してテーブル・グリッドに表示
 */

// グローバル状態管理
const state = {
    currentTab: 'stations',
    stationsData: null,
    programData: null
};

/**
 * ページ初期化処理
 */
function initializePage() {
    setupTabNavigation();
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

    } catch ( err ) {
        showLoading( false );
        showError( `Failed to load stations: ${ err.message }` );
        console.error( 'Error loading stations:', err );
    }
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
            <div class="program-time">${ formatProgramTime( program.ft, program.to ) }</div>
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
 * 番組時刻をフォーマット
 * @param {string} ft - 開始時刻 (YYYYMMDDHHmm)
 * @param {string} to - 終了時刻 (YYYYMMDDHHmm)
 * @returns {string} フォーマットされた時刻文字列
 */
function formatProgramTime( ft, to ) {
    if ( !ft || !to ) return '';

    const formatTime = ( timeStr ) => {
        if ( timeStr.length !== 12 ) return timeStr;
        const hour = timeStr.substring( 8, 10 );
        const minute = timeStr.substring( 10, 12 );
        return `${ hour }:${ minute }`;
    };

    return `${ formatTime( ft ) } - ${ formatTime( to ) }`;
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