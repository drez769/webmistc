<?php
ini_set('max_execution_time', 0);
header("Access-Control-Allow-Origin: *");

//this script requires mkvmerge, sox, and ffmpeg to be installed on a unix system.
$ABSOLUTE_PATH = '/your/path/here/';

$VIDEO_EXT = '.webm';
$AUDIO_EXT = '.ogg';

//the final output audio and video are both webm.
$AUDIO_NAME = v4() . $VIDEO_EXT;
$EXTRACTED_AUDIO_NAME = v4() . $AUDIO_EXT;

$VIDEO_NAME = v4() . $VIDEO_EXT;
$EXTRACTED_VIDEO_NAME = v4() . $VIDEO_EXT;

$cmdList = array();
$tempFileList = array();
if (count($_POST) > 0) {
    //if the input seems valid.
    if (isset($_POST['json']) && isset($_POST['type']) && in_array($_POST['type'], array('video/webm', 'audio/webm'))) {
        $json = json_decode($_POST['json']);
        //build the command for to combine audio and/or video.
        $presenterFileStr = "";
        foreach ($json->presenter as $presenter) {
            foreach ($presenter as $file) {
                $tempFileName = v4() . (($_POST['type'] == 'video/webm') ? $VIDEO_EXT : $AUDIO_EXT);
                $tempFileList[] = $tempFileName;
                //if we are processing presenter video.
                if ($_POST['type'] == 'video/webm') {
                    //chrome does not necessarily encode audio before video.
                    //in other words sometimes the file is stream 0 audio stream 1 video and vice versa.
                    //mkvmerge fails if they are not in the same order for every file, so we ensure this below.
                    array_push($cmdList, 'ffmpeg -y -i ' . $ABSOLUTE_PATH . $file->_id . ' -map 0:a -map 0:v -c copy ' . $ABSOLUTE_PATH . $tempFileName . '');
                } //if we are processing presenter audio.
                else {
                    //sox does not work on webm so we convert to ogg.
                    array_push($cmdList, 'ffmpeg -y -i ' . $ABSOLUTE_PATH . $file->_id . ' -vn ' . $ABSOLUTE_PATH . $tempFileName . '');
                }
                //construct the concatenation string.
                $presenterFileStr .= ($presenterFileStr == '')
                    ? $ABSOLUTE_PATH . $tempFileName . ' '
                    : ' +' . $ABSOLUTE_PATH . $tempFileName . ' ';
            }
        }
        //the presenter now has the option to record only audio or both audio and video.
        switch ($_POST['type']) {
            //if we are processing presenter video.
            case 'video/webm':
                //execue mkvmerge to combine all of the videos which include sound.
                array_push($cmdList, 'mkvmerge -o ' . $ABSOLUTE_PATH . $VIDEO_NAME . ' ' . $presenterFileStr);
                //next we extract the audio and video separately, with conversion from webm to ogg for audio.
                array_push($cmdList, 'ffmpeg -y -i ' . $ABSOLUTE_PATH . $VIDEO_NAME . ' -an -vcodec copy ' . $ABSOLUTE_PATH . $EXTRACTED_VIDEO_NAME . '');
                array_push($cmdList, 'ffmpeg -y -i ' . $ABSOLUTE_PATH . $VIDEO_NAME . ' -vn ' . $ABSOLUTE_PATH . $EXTRACTED_AUDIO_NAME . '');
                break;
            //if we are processing presenter audio.
            case 'audio/webm':
                //sox -v balances volume among multiple files.
                array_push($cmdList, 'sox ' . str_replace('+', '-v 1 ', $presenterFileStr) . $ABSOLUTE_PATH . $EXTRACTED_AUDIO_NAME);
                break;
        }
        //for each participant file we convert to ogg and combine one at a time using sox and the extracted audio file.
        foreach ($json->participants as $participant) {
            foreach ($participant as $file) {
                $tempFileName1 = v4() . $AUDIO_EXT;
                $tempFileList[] = $tempFileName1;
                //sox does not work on webm files.
                array_push($cmdList, 'ffmpeg -y -i ' . $ABSOLUTE_PATH . $file->_id . ' -vn ' . $ABSOLUTE_PATH . $tempFileName1 . '');
                $tempFileName2 = v4() . $AUDIO_EXT;
                $tempFileList[] = $tempFileName2;
                //http://sox.sourceforge.net/Docs/FAQ
                //sox -m f1.wav "|sox f2.wav -p pad 4" "|sox f3.wav -p pad 8" out.wav
                array_push($cmdList, 'sox -m ' . $ABSOLUTE_PATH . $EXTRACTED_AUDIO_NAME . ' -v 1 "|sox ' . $ABSOLUTE_PATH . $tempFileName1 . ' -p pad ' . $file->offset . '" ' . $ABSOLUTE_PATH . $tempFileName2 . ' channels 1');
                //the merged version is now the resulting audio file.
                $EXTRACTED_AUDIO_NAME = $tempFileName2;
            }
        }
        //finally we convert the ogg back to webm for compatibility.
        array_push($cmdList, 'ffmpeg -y -i ' . $ABSOLUTE_PATH . $EXTRACTED_AUDIO_NAME . ' -vn ' . $ABSOLUTE_PATH . $AUDIO_NAME . '');
        //if we are processing presenter video.
        if ($_POST['type'] == 'video/webm') {
            //merge the audio file back into the video file.
            array_push($cmdList, 'ffmpeg -y -i ' . $ABSOLUTE_PATH . $EXTRACTED_VIDEO_NAME . ' -i ' . $ABSOLUTE_PATH . $AUDIO_NAME . ' -c copy ' . $ABSOLUTE_PATH . $VIDEO_NAME . '');
        }
        //delete all temp files to save space.
        foreach ($tempFileList as $tempFile) {
            array_push($cmdList, 'rm ' . $ABSOLUTE_PATH . $tempFile);
        }
        //run all commands in order, redirect all outputs and errors to log.
        $cmd = implode(" >> /var/log/ffmpeg.log 2>&1 && ", $cmdList);
        exec($cmd);
        if (file_exists($ABSOLUTE_PATH . (($_POST['type'] == 'video/webm') ? $VIDEO_NAME : $AUDIO_NAME))) {
            //return the output JSON
            echo json_encode(array("result" => "https://www.jkwiz.com/videos/" . (($_POST['type'] == 'video/webm') ? $VIDEO_NAME : $AUDIO_NAME)), JSON_UNESCAPED_SLASHES);
        } else {
            //http response code not found, the video/audio file could not be created.
            http_response_code(404);
        }
    } else {
        //http response code bad request both type and json are required. type must be audio|video/webm
        http_response_code(400);
    }
}

function v4()
{
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0x0fff) | 0x4000, mt_rand(0, 0x3fff) | 0x8000, mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff));
}