
// Module CSV - Copyright David Worms <open@adaltas.com> (MIT Licensed)

var EventEmitter = require('events').EventEmitter,
	fs = require('fs');

// Utils function
var merge = function(obj1,obj2){
	var r = obj1||{};
	for(var key in obj2){
		r[key] = obj2[key];
	}
	return r;
}

module.exports = function(){
	var state = {
		count: 0,
		field: '',
		line: [],
		lastC: '',
		quoted: false,
		commented: false,
		buffer: null,
		bufferPosition: 0
	}
	
	// Defined Class
	
	var CSV = function(){
		// Set options
		this.readOptions = {
			delimiter: ',',
			quote: '"',
			escape: '"',
			columns: null,
		        ltrimFields: false,
		        rtrimFields: false,
			flags: 'r',
			encoding: 'utf8',
			bufferSize: 8 * 1024 * 1024
		};
		this.writeOptions = {
			delimiter: null,
			quote: null,
			escape: null,
			lineBreaks: null,
			flags: 'w',
			encoding: 'utf8',
			bufferSize: null,
			end: true
		};
	}
	CSV.prototype.__proto__ = EventEmitter.prototype;
	
	// Reading API
	
	CSV.prototype.from = function(data,options){
		if(options) merge(this.readOptions,options);
		var self = this;
		process.nextTick(function(){
			if(data instanceof Array){
				// todo, check if we can now remove those
				if( csv.writeOptions.lineBreaks === null ){
					csv.writeOptions.lineBreaks = "\r\n";
				}
				data.forEach(function(line){
					state.line = line;
					flush();
				})
			}else{
				try{
					parse(data);
				}catch(e){
					self.emit('error', e);
					return;
				}
			}
			self.end();
		});
		return this;
	}
	CSV.prototype.fromStream = function(readStream, options){
		if(options) merge(this.readOptions,options);
		var self = this;
		readStream.on('data', function(data) { 
			try{
				parse(data);
			}catch(e){
				self.emit('error', e);
				this.destroy();
			}
		});
		readStream.on('error', function(error) { self.emit('error', error) });
		readStream.on('end', function() {
			self.end();
		});
		this.readStream = readStream;
		return this;
	}
	CSV.prototype.fromPath = function(path, options){
		if(options) merge(this.readOptions,options);
		var stream = fs.createReadStream(path, this.readOptions);
		stream.setEncoding(this.readOptions.encoding);
		return this.fromStream(stream, null);
	}
	
	// Writting API
	
	CSV.prototype.write = function(line){
		if(typeof line === 'string'){
			return parse(line);
		}
		write(line);
	}
	CSV.prototype.end = function(){
		if (state.quoted) {
			csv.emit('error', new Error('Quoted field not terminated'));
		} else {
			// dump open record
			if (state.field) {
			        flushField();
			}
			if (state.line.length > 0) {
				flush();
			}
			if(csv.writeStream){
				if(state.bufferPosition !== 0){
					csv.writeStream.write(state.buffer.slice(0, state.bufferPosition));
				}
				if(this.writeOptions.end){
					csv.writeStream.end();
				}else{
					csv.emit('end', state.count);
				}
			}else{
				csv.emit('end', state.count);
			}
		}
	}
	
	CSV.prototype.toStream = function(writeStream, options){
		if(options) merge(this.writeOptions,options);
		var self = this;
		switch(this.writeOptions.lineBreaks){
			case 'auto':
				this.writeOptions.lineBreaks = null;
				break;
			case 'unix':
				this.writeOptions.lineBreaks = "\n";
				break;
			case 'mac':
				this.writeOptions.lineBreaks = "\r";
				break;
			case 'windows':
				this.writeOptions.lineBreaks = "\r\n";
				break;
			case 'unicode':
				this.writeOptions.lineBreaks = "\u2028";
				break;
		}
		writeStream.on('close', function(){
			self.emit('end',state.count);
		})
		this.writeStream = writeStream;
		state.buffer = new Buffer(this.writeOptions.bufferSize||this.readOptions.bufferSize);
		state.bufferPosition = 0;
		return this;
	}
	CSV.prototype.toPath = function(path, options){
		// Merge user provided options
		if(options) merge(this.writeOptions,options);
		// clone options
		var options = merge({},this.writeOptions);
		// Delete end property which otherwise overwrite `WriteStream.end()`
		delete options.end;
		// Create the write stream
		var stream = fs.createWriteStream(path, options);
		return this.toStream(stream, null);
	}
	
	// Transform API
	
	CSV.prototype.transform = function(callback){
		this.transformer = callback;
		return this;
	}
	
	var csv = new CSV();
	
	// Private API
	
	function write(line){
		if(line !== null){
			csv.emit('data',line,state.count);
			if(typeof line === 'object'){
				if(!(line instanceof Array)){
					var columns = csv.writeOptions.columns || csv.readOptions.columns;
					var _line = [];
					if(columns){
						columns.forEach(function(column, i){
							_line[i] = (typeof line[column] === 'undefined' || line[column] === null) ? '' : line[column];
						})
					}else{
						for(var column in line){
							_line.push(line[column]);
						}
					}
					line = _line;
					_line = null;
				}
				if(line instanceof Array){
					var newLine = state.count ? csv.writeOptions.lineBreaks || "\r" : '';
					line.forEach(function(field,i){
						if(typeof field == 'string'){
							// fine 99% of the cases, keep going
						}else if(typeof field == 'number'){
							field = '' + field;
						}else if(field instanceof Date){
							field = '' + field.getTime();
						}
						if(field){
							var containsdelimiter = field.indexOf(csv.writeOptions.delimiter || csv.readOptions.delimiter) >= 0;
							var containsQuote = field.indexOf(csv.writeOptions.quote || csv.readOptions.quote) >= 0;
							var containsLinebreak = field.indexOf("\r") >= 0 || field.indexOf("\n") >= 0;
							if(containsQuote){
								field = field.replace(
										new RegExp(csv.writeOptions.quote || csv.readOptions.quote,'g')
									  , (csv.writeOptions.escape || csv.readOptions.escape)
									  + (csv.writeOptions.quote || csv.readOptions.quote));
							}
							if(containsQuote || containsdelimiter || containsLinebreak){
								field = (csv.writeOptions.quote || csv.readOptions.quote) + field + (csv.writeOptions.quote || csv.readOptions.quote);
							}
							newLine += field;
						}
						if(i!==line.length-1){
							newLine += csv.writeOptions.delimiter || csv.readOptions.delimiter;
						}
					});
					line = newLine;
				}
			}
			if(state.buffer){
				if(state.bufferPosition + Buffer.byteLength(line,'utf8') > csv.readOptions.bufferSize){
					csv.writeStream.write(state.buffer.slice(0, state.bufferPosition));
					state.buffer = new Buffer(csv.readOptions.bufferSize);
					state.bufferPosition = 0;
				}
				state.bufferPosition += state.buffer.write(line, state.bufferPosition,'utf8');
			}
		}
		state.count++;
		state.line = [];
		state.lastC = '';
	}
	
	function parse(chars){
		chars = '' + chars;
		for (var i = 0, l = chars.length; i < l; i++) {
			var c = chars.charAt(i);
			switch (c) {
				case csv.readOptions.escape:
				case csv.readOptions.quote:
					if( state.commented ) break;
					var isEscape = false;
					if (c === csv.readOptions.escape) {
						// Make sure the escape is really here for escaping:
						// if escape is same as quote, and escape is first char of a field and it's not quoted, then it is a quote
						// next char should be an escape or a quote
						var nextChar = chars.charAt(i + 1);
						if( !( csv.readOptions.escape === csv.readOptions.quote && !state.field && !state.quoted )
						&&   ( nextChar === csv.readOptions.escape || nextChar === csv.readOptions.quote ) ) {
							i++;
							isEscape = true;
							c = chars.charAt(i);
							state.field += c;
						}
					}
					if (!isEscape && (c === csv.readOptions.quote)) {
						if (state.field && !state.quoted) {
							// Treat quote as a regular character
							state.field += c;
							break;
						}
						if (state.quoted) {
							// Make sure a closing quote is followed by a delimiter
							var nextChar = chars.charAt(i + 1);
							if (nextChar && nextChar != '\r' && nextChar != '\n' && nextChar !== csv.readOptions.delimiter) {
								throw new Error('Invalid closing quote; found "' + nextChar + '" instead of delimiter "' + csv.readOptions.delimiter + '"');
							}
							state.quoted = false;
						} else if (state.field === '') {
							state.quoted = true;
						}
					}
					break;
				case csv.readOptions.delimiter:
					if( state.commented ) break;
					if( state.quoted ) {
						state.field += c;
					}else{
					        flushField();
					}
					break;
				case '\n':
				    if(state.quoted) {
						state.field += c;
						break;
					}
					if( !csv.readOptions.quoted && state.lastC === '\r' ){
						break;
					}
				case '\r':
				    if(state.quoted) {
						state.field += c;
						break;
					}
					if( csv.writeOptions.lineBreaks === null ){
						csv.writeOptions.lineBreaks = c + ( c === '\r' && chars.charAt(i+1) === '\n' ? '\n' : '' );
					}

			                flushField();
					flush();
					break;
				default:
					if(state.commented) break;
					state.field += c;
			}
			state.lastC = c;
		}
	}

        function flushField() {
	    var newField = state.field;
	    if ( csv.readOptions.ltrimFields ) {
		newField = newField.replace(/^\s+/, '');
	    }
	    if ( csv.readOptions.rtrimFields ) {
		newField = newField.replace(/\s+$/, '');
	    }

	    state.line.push(newField);
	    state.field = '';
	}

	function flush(){
		if(csv.readOptions.columns){
			if(state.count === 0 && csv.readOptions.columns === true){
				csv.readOptions.columns = state.line;
				state.line = [];
				state.lastC = '';
				return;
			}
			var line = {};
			csv.readOptions.columns.forEach(function(column, i){
				line[column] = state.line[i]||null;
			})
			state.line = line;
			line = null;
		}
		var line = csv.transformer ? csv.transformer(state.line, state.count) : state.line;
		write(line);
	}
	return csv;
};
