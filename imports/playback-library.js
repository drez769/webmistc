import {Meteor} from 'meteor/meteor';
import {start} from './recording-library.js';
import {Session} from 'meteor/session';

export var Playback = {};

//HACK: scope binding
const self = this;
let timings = [];
let videoTracking = null;
let pbSlideTracker = null; //Timer to keep the playback slider in the correct position
let startedTime = -1;
let elapsedTime = -1;
let totalTime = 0; //Unused. Total time a recording has been played back so far.
				   //Would be needed to fix syncing bug that previously existed.
				   //Instead, syncing is done based on an audio/video recording timer.
				   //A few other code changes would be needed to use this correctly...
let recordings = "";
let isPaused = false;

// HACK: need to figure out the proper scoping to 
// access this from the overlay library
function replaceNote(whichNote, title, number) {
    const d3Notes = d3.select(".annotation");
    // console.log(d3Notes);
    const d3LastNode = d3Notes[0].pop();
    if (d3LastNode) {
        $(d3LastNode).remove();
        const id = d3LastNode.id;
        Meteor.call('markEraser', title, number, id);
    }
};

function initTimes(recordings) {
    const start = _.head(recordings);
    const stop = _.last(recordings);
    self.start = start.time;
    self.stop = stop.time;
}

function removeTimes(recordings) {
    // drop first and last element
    recordings = _.drop(recordings);
    recordings = _.dropRight(recordings);
    return recordings;
}

Playback.upload = function (json) {
    initTimes(json);
    recordings = removeTimes(json);
};

Playback.skipBack = function () {
    if (isPaused) {
        elapsedTime = elapsedTime - 5000;
        if (elapsedTime < 0) {elapsedTime = 0;}
		totalTime = totalTime > 5000 ? totalTime-5000 : 0;
    } else {
        Playback.pause();
        elapsedTime = elapsedTime - 5000;
        if (elapsedTime < 0) {elapsedTime = 0;}
		totalTime = totalTime > 5000 ? totalTime-5000 : 0;
        Playback.play();
    }
	Playback.updateSlider();
};

Playback.stop = function () {
	// Clear timers tracking the video and reset playback slider
	Playback.cleanup();
	$('#pbslider').slider('setValue', 0);
	
    _.each(timings, function(timing){
        Meteor.clearTimeout(timing)
    })
	timings = [];
    isPaused = true;
    startedTime = -1;
    elapsedTime = -1;
	totalTime = 0;
};

Playback.pause = function () {
	Playback.cleanup();
	
    _.each(timings, function(timing){
        Meteor.clearTimeout(timing)
    })
	timings = [];
    isPaused = true;
    elapsedTime = Date.now()-startedTime;
	totalTime += elapsedTime;
};

Playback.play = function () {
    trackVideo();
    let firstTimeStamp = self.start;
    isPaused = false;
    startedTime = Date.now();
	let video = document.getElementById('uploadedRecording');
	
	// If playback is NOT being started from a stop
    if (elapsedTime != -1) {
		firstTimeStamp += (video.currentTime*1000);
		
		// Using totalTime here fixes the previous bug, but syncing with video is better
        // firstTimeStamp += totalTime;
        elapsedTime = -1;
    }
	
	// For each recorded JSON event, check if it should be queued to play
	// based on the amount of time played so far
	let foundNextUpdate = false;
    _.each(recordings, function (recording, i) {
		
		// If a recorded JSON event should come after where we currently are in time
        if (recording.time >= firstTimeStamp) {
			// Ideally this should update the slideshow to show the closest last slide,
			// however probably won't work if the last JSON event was a marker or something
			//TODO better to implement a function to find the last slide change to show instead
			if (!foundNextUpdate) {
				foundNextUpdate = true;
				let lastUpdate = i > 0 ? i-1 : 0;
				updateSlideShow(recordings[lastUpdate]);
			}
			
			// This JSON event comes after current playback time, so queue it to play back
            timings.push(Meteor.setTimeout(
                function () { updateSlideShow(recording); },
                ( parseInt(recording.time - firstTimeStamp) )
            ));
        }
    });
};

// Updates the slideshow to show the next JSON event
let updateSlideShow = function (recording) {
	switch (recording.state) {
	case 'session':
		const sessionState = recording.params[0];
		Session.set(recording.action, sessionState);
		break;
	case 'database':
		const isReplaceOn = Session.get('overlay.tool.replace');
		if (isReplaceOn) {
			const title = recording.params[0];
			const page = recording.params[1];
			replaceNote('previous', title, page);
		}
		Meteor.apply(recording.action, recording.params);
		break;
	}
	let video = document.getElementById('uploadedRecording');
	// console.log("Current vid - this");
	// console.log(video.currentTime);
	// console.log(recording.time - self.start + elapsedTime)
	// console.log(firstTimeStamp);
}

Playback.skipForward = function () {
    if (isPaused) {
        elapsedTime = elapsedTime + 5000;
		totalTime += 5000;
    } else {
        Playback.pause();
        elapsedTime = elapsedTime + 5000;
		totalTime += 5000;
        Playback.play();
    }
	Playback.updateSlider();
};

// This is straight from slackOverflow
String.prototype.toHHMMSS = function () {
    var sec_num = parseInt(this, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    //if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
};

// Function to use timers to keep track of current playback time and slider position
trackVideo = function (){
	let video = document.getElementById('uploadedRecording');
	document.getElementById('duration').placeholder=video.duration.toString().toHHMMSS();

	// Timer to keep track of the current playback time in the video
    videoTracking = Meteor.setInterval(
		function(){
			// console.log("currentTime: "+video.currentTime);
			document.getElementById('position').placeholder=video.currentTime.toString().toHHMMSS();
		}, 500 // milliseconds
	);
	
	// For tracking the playback slider
	let sliderMax = $("#pbslider").data("slider-max");
	let interval = video.duration / sliderMax;
	Playback.updateSlider();
	pbSlideTracker = Meteor.setInterval(function () {
		let currentPosition = video.currentTime / interval;
		// console.log("Slide: " + video.currentTime / interval)
		// console.log("currentTime " + video.currentTime);
		// console.log(Date.now()-startedTime);
		$('#pbslider').slider('setValue', currentPosition);
	}, interval * 1000);
};

// Update the playback slider based on the current A/V recording time
Playback.updateSlider = function() {
	let video = document.getElementById('uploadedRecording');
	let sliderMax = $("#pbslider").data("slider-max");
	let interval = video.duration / sliderMax;
	$('#pbslider').slider('setValue', video.currentTime / interval);
	document.getElementById('position').placeholder=video.currentTime.toString().toHHMMSS();
}

// Clear timers that track playback position and slider position
Playback.cleanup = function() {
    Meteor.clearInterval(videoTracking);
	Meteor.clearInterval(pbSlideTracker);
}