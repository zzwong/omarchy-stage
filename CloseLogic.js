// Pure helpers shared with the mocked tests (no compositor side effects).
function address(value) {
    var s = String(value || "").toLowerCase().replace(/^0x/, "")
    return /^[0-9a-f]+$/.test(s) && !/^0+$/.test(s) ? "0x" + s : ""
}

function neighbor(addresses, selected, index) {
    if (index < 0 || addresses.length === 0) return -1
    var found = addresses.indexOf(selected)
    return found >= 0 ? found : Math.min(index, addresses.length - 1)
}

function closeLua(value) {
    var addr = address(value)
    return addr ? 'hl.dsp.window.close({ window = "address:' + addr + '" })' : ""
}

function canRequest(addr, live, pending, now) {
    return !!addr && live.indexOf(addr) >= 0 && !(pending[addr] > now)
}
