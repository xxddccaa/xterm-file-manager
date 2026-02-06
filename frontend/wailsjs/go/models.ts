export namespace main {
	
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

}

