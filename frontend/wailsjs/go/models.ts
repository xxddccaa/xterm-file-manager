export namespace app {
	
	export class ClipboardData {
	    files: string[];
	    operation: string;
	
	    static createFrom(source: any = {}) {
	        return new ClipboardData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = source["files"];
	        this.operation = source["operation"];
	    }
	}
	export class FileInfo {
	    name: string;
	    size: number;
	    mode: string;
	    modTime: string;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.mode = source["mode"];
	        this.modTime = source["modTime"];
	        this.isDir = source["isDir"];
	    }
	}
	export class LocalFileInfo {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    modTime: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalFileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	    }
	}
	export class RemoteDepsStatus {
	    hasRsync: boolean;
	    hasInotify: boolean;
	    rsyncVersion: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new RemoteDepsStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasRsync = source["hasRsync"];
	        this.hasInotify = source["hasInotify"];
	        this.rsyncVersion = source["rsyncVersion"];
	        this.message = source["message"];
	    }
	}
	export class SSHConfigEntry {
	    id: string;
	    host: string;
	    hostname: string;
	    user: string;
	    port: number;
	    identityFile: string;
	
	    static createFrom(source: any = {}) {
	        return new SSHConfigEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.host = source["host"];
	        this.hostname = source["hostname"];
	        this.user = source["user"];
	        this.port = source["port"];
	        this.identityFile = source["identityFile"];
	    }
	}
	export class SSHServerInfo {
	    distro: string;
	    kernel: string;
	    architecture: string;
	    cpuCores: number;
	    cpuModel: string;
	    memoryTotalBytes: number;
	    memoryUsedBytes: number;
	    memoryAvailableBytes: number;
	    diskTotalBytes: number;
	    diskUsedBytes: number;
	    diskAvailableBytes: number;
	    uptimeSeconds: number;
	    loadAverage1: string;
	    networkInterface: string;
	    networkRxBytesPerSec: number;
	    networkTxBytesPerSec: number;
	    networkRateReady: boolean;
	    collectedAtUnix: number;
	
	    static createFrom(source: any = {}) {
	        return new SSHServerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.distro = source["distro"];
	        this.kernel = source["kernel"];
	        this.architecture = source["architecture"];
	        this.cpuCores = source["cpuCores"];
	        this.cpuModel = source["cpuModel"];
	        this.memoryTotalBytes = source["memoryTotalBytes"];
	        this.memoryUsedBytes = source["memoryUsedBytes"];
	        this.memoryAvailableBytes = source["memoryAvailableBytes"];
	        this.diskTotalBytes = source["diskTotalBytes"];
	        this.diskUsedBytes = source["diskUsedBytes"];
	        this.diskAvailableBytes = source["diskAvailableBytes"];
	        this.uptimeSeconds = source["uptimeSeconds"];
	        this.loadAverage1 = source["loadAverage1"];
	        this.networkInterface = source["networkInterface"];
	        this.networkRxBytesPerSec = source["networkRxBytesPerSec"];
	        this.networkTxBytesPerSec = source["networkTxBytesPerSec"];
	        this.networkRateReady = source["networkRateReady"];
	        this.collectedAtUnix = source["collectedAtUnix"];
	    }
	}
	export class SyncRule {
	    id: string;
	    serverName: string;
	    sshHost: string;
	    remotePath: string;
	    localPath: string;
	    source: string;
	    active: boolean;
	    status: string;
	    lastSync: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new SyncRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.serverName = source["serverName"];
	        this.sshHost = source["sshHost"];
	        this.remotePath = source["remotePath"];
	        this.localPath = source["localPath"];
	        this.source = source["source"];
	        this.active = source["active"];
	        this.status = source["status"];
	        this.lastSync = source["lastSync"];
	        this.error = source["error"];
	    }
	}

}

