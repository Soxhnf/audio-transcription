import { Component, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Clipboard } from '@capacitor/clipboard';
import { ToastController } from '@ionic/angular';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ActionSheetController } from '@ionic/angular';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {

  @ViewChild('fileInput') fileInput!: ElementRef;

  transcribedText = '';
  isRecording = false;
  audioURL: SafeUrl | null = null;

  mediaRecorder!: MediaRecorder;
  audioChunks: Blob[] = [];
  recordingSeconds = 0;
  recordingTime = '00:00';
  timerInterval: any;
  selectedFile: File | null = null;
  previewType: 'audio' | 'video' | null = null;

  


  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private toastCtrl: ToastController,
    private sanitizer: DomSanitizer,
    private actionSheetCtrl: ActionSheetController
  ) {}

  // 🎙️ Start recording
  // 🎙️ Start recording
  async startRecording() {
    this.isRecording = true;
    this.audioURL = null; // Clear previous recording when starting new
    this.recordingSeconds = 0;
    this.updateRecordingTime();

    this.timerInterval = setInterval(() => {
      this.recordingSeconds++;
      this.updateRecordingTime();
    }, 1000);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioChunks = [];
    this.mediaRecorder = new MediaRecorder(stream);

    this.mediaRecorder.ondataavailable = (event) => {
      this.audioChunks.push(event.data);
    };

    this.mediaRecorder.onstop = () => {
      this.previewType = 'audio';
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(audioBlob);
      
      // Update the URL
      this.audioURL = this.sanitizer.bypassSecurityTrustUrl(url);

      // Force Angular to detect the change immediately
      this.cdr.detectChanges(); 

      this.sendAudioToBackend(audioBlob);
    };

    this.mediaRecorder.start();
  }

  // ⏹️ Stop recording
  stopRecording() {
    this.isRecording = false;

  clearInterval(this.timerInterval);
  this.timerInterval = null;
    this.mediaRecorder.stop();
    this.isRecording = false;
  }

  // 📤 Send audio to backend
  sendAudioToBackend(audio: Blob) {


  const formData = new FormData();
  formData.append('file', audio, 'recording.webm');

  this.http.post<any>('http://localhost:8000/transcribe', formData)
    .subscribe({
      next: (res) => {
        this.transcribedText = res.text;
      
        this.cdr.detectChanges();
      },
      error: () => {
     
        alert('Transcription failed');
      }
    });
}


  async copyText() {
  if (!this.transcribedText) return;

  await Clipboard.write({
    string: this.transcribedText
  });

  const toast = await this.toastCtrl.create({
    message: 'Texte copié dans le presse-papiers !',
    duration: 1500,
    position: 'bottom',
    color: 'success'
  });

  toast.present();
}
updateRecordingTime() {
  const minutes = Math.floor(this.recordingSeconds / 60);
  const seconds = this.recordingSeconds % 60;

  this.recordingTime =
    `${minutes.toString().padStart(2, '0')}:` +
    `${seconds.toString().padStart(2, '0')}`;
}

// 1. Afficher le menu de choix
  async presentDownloadActionSheet() {
    if (!this.transcribedText) return;

    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Exporter la transcription',
      buttons: [
        {
          text: 'Fichier Word (.docx)',
          icon: 'document-text-outline',
          handler: () => {
            this.downloadDocx();
          }
        },
        {
          text: 'Fichier PDF (.pdf)',
          icon: 'document-attach-outline', // ou une icône PDF si dispo
          handler: () => {
            this.downloadPdf();
          }
        },
        {
          text: 'Fichier Texte (.txt)',
          icon: 'text-outline',
          handler: () => {
            this.downloadTxt();
          }
        },
        {
          text: 'Annuler',
          icon: 'close',
          role: 'cancel'
        }
      ]
    });
    await actionSheet.present();
  }

  // 2. Générer Word
  downloadDocx() {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun(this.transcribedText),
            ],
          }),
        ],
      }],
    });

    Packer.toBlob(doc).then((blob) => {
      saveAs(blob, 'transcription.docx');
      this.showToast('Téléchargement Word terminé');
    });
  }

  // 3. Générer PDF
  downloadPdf() {
    const doc = new jsPDF();
    
    // SplitTextToSize permet de revenir à la ligne automatiquement
    const splitText = doc.splitTextToSize(this.transcribedText, 190);
    
    doc.setFontSize(12);
    doc.text(splitText, 10, 10);
    doc.save('transcription.pdf');
    this.showToast('Téléchargement PDF terminé');
  }

  // 4. Générer TXT
  downloadTxt() {
    const blob = new Blob([this.transcribedText], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, 'transcription.txt');
    this.showToast('Téléchargement Texte terminé');
  }

  // Petit utilitaire pour afficher un message
  async showToast(msg: string) {
    const toast = await this.toastCtrl.create({
      message: msg,
      duration: 2000,
      color: 'success',
      position: 'bottom'
    });
    toast.present();
  }
  onAudioFileSelected(event: any) {
  const file = event.target.files[0];
  if (!file) return;

  this.handleImportedFile(file);
}

onVideoFileSelected(event: any) {
  const file = event.target.files[0];
  if (!file) return;

  this.handleImportedFile(file);
}

handleImportedFile(file: File) {
  const url = URL.createObjectURL(file);
  this.audioURL = this.sanitizer.bypassSecurityTrustUrl(url);

  if (file.type.startsWith('video')) {
    this.previewType = 'video';
  } else {
    this.previewType = 'audio';
  }

  this.sendFileToBackend(file);
}

sendFileToBackend(file: File | Blob) {
  const formData = new FormData();
  formData.append('file', file);

  this.http.post<any>('http://localhost:8000/transcribe', formData)
    .subscribe({
      next: res => {
        this.transcribedText = res.text;
        this.cdr.detectChanges();
      },
      error: () => alert('Transcription failed')
    });
}

}


