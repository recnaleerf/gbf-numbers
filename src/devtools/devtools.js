//var names = [];
var hp = [];
var hpmax = [];

var port;

var thousands;

// Inserts thousands separators as needed
function commatize(x) {
	return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Returns a string containing both a fraction and a percentage given the current and max HP
// Empty string is returned if the current HP is 0
function getHpString(hp, hpmax) {
	if(hp == 0) {
		return "";
	}
	
	var percent = Math.round(hp / hpmax * 10000) / 100;
	
	if(thousands) {
		return commatize(hp) + "/" + commatize(hpmax) + " (" + percent + "%)";
	} else {
		return hp + "/" + hpmax + " (" + percent + "%)";
	}
}

// Resets variables
function reset() {
	//names = [];
	hp = [];
	hpmax = [];
}

// Sends message to the background script (to be sent to the content script) with the updated HPs
function updateHp() {
	var hps = [];
	
	for(var i = 0; i < hp.length; i++) {
		hps.push(getHpString(hp[i], hpmax[i]));
	}
	
	port.postMessage({
		tabId: chrome.devtools.inspectedWindow.tabId,
		hps: hps
	});
}

// Parses the start.json response that is loaded when a battle first starts
function parseStart(content, encoding) {
	reset();
	
	var obj = JSON.parse(content);
	var enemies = obj.boss.param;
	
	for(var i = 0; i < enemies.length; i++) {
		//names.push(enemies[i].name);
		hp.push(enemies[i].hp);
		hpmax.push(enemies[i].hpmax);
	}
	
	updateHp();
}

// Parses the responses from abilities, summons, and attacks
function parseResponse(content, encoding) {
	var obj = JSON.parse(content);
	
	// if the response is the popup from clicking too fast
	if(!("scenario" in obj)) {
		return;
	}
	
	var log = obj.scenario;
	var length = log.length;
	
	// under certain scenarios, an object will be returned instead of an array (e.g. when quatre's skill for resetting ability cooldown procs)
	// in this case, the keys of the object are numbered sequentially from 0 with some extra things
	if(log.length === undefined) {
		// we want only the numerical keys
		length = Object.keys(log).filter(function(value) {
				return parseInt(value) == value;
			}).length;
	}
	
	for(var i = 0; i < length; i++) {
		var curr = log[i];
		
		// no idea why there's randomly an empty array sometimes...
		if(!("cmd" in curr)) {
			continue;
		}
		
		if((curr.cmd === "damage" || curr.cmd === "heal") && curr.to === "boss") {
			// ability damage, extra damage (from summons (e.g. ranko) or supers (e.g. charlotte's super in break)), chain burst
			// enemy heals also use the same json format
			for(var j = 0; j < curr.list.length; j++) {
				hp[curr.list[j].pos] = curr.list[j].hp;
			}
		} else if(curr.cmd === "summon" && curr.kind.indexOf("damage") > -1) {
			// main summon damage
			var damage = curr.list[curr.list.length - 1].damage;
			
			for(var j = 0; j < damage.length; j++) {
				hp[damage[j].pos] = damage[j].hp;
			}
		} else if(curr.cmd === "attack" && curr.from === "player") {
			// regular attacks
			var damage = curr.damage;
			
			if(damage.length === undefined) {
				// counters after first hit
				for(var key in damage) {
					for(var j = 0; j < damage[key].length; j++) {
						hp[damage[key][j].pos] = damage[key][j].hp;
					}
				}
			} else {
				for(var j = 0; j < damage.length; j++) {
					for(var k = 0; k < damage[j].length; k++) {
						hp[damage[j][k].pos] = damage[j][k].hp;
					}
				}
			}
		} else if(curr.cmd === "die" && curr.to === "boss") {
			// if boss dies before the attack
			hp[curr.pos] = 0;
		} else if(curr.cmd.indexOf("special") > -1 && curr.target === "boss") {
			// main super damage
			for(var j = 0; j < curr.list.length; j++) {
				var damage = curr.list[j].damage;
				for(var k = 0; k < damage.length; k++) {
					hp[damage[k].pos] = damage[k].hp;
				}
			}
		}
	}
	
	updateHp();
}

// Connect to background page
port = chrome.runtime.connect( {name: "devtools"} );

// Listen to options changes
port.onMessage.addListener(
	function(request) {
		if("thousands" in request) {
			thousands = request.thousands;
			updateHp();
		}
	});

// Listen to network requests
chrome.devtools.network.onRequestFinished.addListener(
	function(request) {
		if(request.request.url.indexOf("ability_result.json") > -1 || request.request.url.indexOf("summon_result.json") > -1 || request.request.url.indexOf("normal_attack_result.json") > -1) {
			request.getContent(parseResponse);
		} else if(request.request.url.indexOf("start.json") > -1) {
			request.getContent(parseStart);
		}
	});
