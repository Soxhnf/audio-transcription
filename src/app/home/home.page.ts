import { Component, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Clipboard } from '@capacitor/clipboard';
import { ToastController, ActionSheetController, AlertController, LoadingController } from '@ionic/angular';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
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
  // Accès aux inputs via ViewChild
  @ViewChild('audioInput') audioInput!: ElementRef;
  @ViewChild('videoInput') videoInput!: ElementRef;

  transcribedText = '';
  isRecording = false;
  audioURL: SafeUrl | null = null;
  previewType: 'audio' | 'video' | null = null;

  // Variables MediaRecorder
  private mediaRecorder: any;
  private audioChunks: Blob[] = [];
  recordingSeconds = 0;
  recordingTime = '00:00';
  private timerInterval: any;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private toastCtrl: ToastController,
    private sanitizer: DomSanitizer,
    private actionSheetCtrl: ActionSheetController,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController
  ) {}

  // ==========================================
  // 🎙️ GESTION DU MICRO
  // ==========================================

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (event: any) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.previewType = 'audio';
        const url = URL.createObjectURL(audioBlob);
        this.audioURL = this.sanitizer.bypassSecurityTrustUrl(url);
        
        // On envoie au backend
        this.sendToBackend(audioBlob);
        this.cdr.detectChanges();
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.startTimer();
    } catch (err) {
      console.error("Erreur micro:", err);
      this.showToast("Impossible d'accéder au micro", 'danger');
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.stopTimer();
      // On coupe le flux micro pour libérer le hardware
      this.mediaRecorder.stream.getTracks().forEach((track: any) => track.stop());
    }
  }

  // ==========================================
  // 📂 GESTION DES FICHIERS & LIENS
  // ==========================================

async presentFileOptions() {
  const actionSheet = await this.actionSheetCtrl.create({
    header: 'IMPORTER UN FICHIER',
    cssClass: 'custom-action-sheet',
    buttons: [
      {
        text: 'Audio local',
        icon: 'musical-notes',
        handler: () => this.audioInput.nativeElement.click()
      },
      {
        text: 'Vidéo locale',
        icon: 'videocam',
        handler: () => this.videoInput.nativeElement.click()
      }
    ]
  });

  await actionSheet.present();

  // Fermer au clic sur le ❌
  document
    .querySelector('.custom-action-sheet .action-sheet-wrapper')
    ?.addEventListener('click', (e: any) => {
      if (e.target.textContent === '✕') {
        actionSheet.dismiss();
      }
    });
}


  onAudioFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) this.handleLocalFile(file, 'audio');
  }

  onVideoFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) this.handleLocalFile(file, 'video');
  }

  private handleLocalFile(file: File, type: 'audio' | 'video') {
    this.previewType = type;
    const url = URL.createObjectURL(file);
    this.audioURL = this.sanitizer.bypassSecurityTrustUrl(url);
    this.sendToBackend(file);
  }

// 🔗 Pop-up Lien URL
async presentUrlPrompt() {
  const alert = await this.alertCtrl.create({
    header: 'Lien Web',
    subHeader: 'Collez l\'URL de la vidéo ou de l\'audio',
    cssClass: 'custom-alert', // <--- IMPORTANT
    inputs: [
      {
        name: 'url',
        type: 'url',
        placeholder: 'https://...',
      }
    ],
    buttons: [
      { text: 'Annuler', role: 'cancel' },
      {
        text: 'Analyser',
        handler: (data) => {
          if (data.url) this.sendUrlToBackend(data.url);
        }
      }
    ]
  });
  await alert.present();
}

  // ==========================================
  // 📡 COMMUNICATION BACKEND
  // ==========================================

  async sendToBackend(fileOrBlob: Blob | File) {
    const loading = await this.loadingCtrl.create({ message: 'Transcription en cours...' });
    await loading.present();

    const formData = new FormData();
    formData.append('file', fileOrBlob, (fileOrBlob instanceof File) ? fileOrBlob.name : 'recording.webm');

    this.http.post<any>('http://localhost:8000/transcribe', formData).subscribe({
      next: (res) => {
        this.transcribedText = res.text;
        loading.dismiss();
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error("Erreur Backend:", err);
        loading.dismiss();
        this.showToast("Échec de la transcription", 'danger');
      }
    });
  }

  async sendUrlToBackend(url: string) {
    if (!url) return;
    const loading = await this.loadingCtrl.create({ message: 'Traitement du lien...' });
    await loading.present();

    this.http.post<any>('http://localhost:8000/transcribe-url', { url }).subscribe({
      next: (res) => {
        this.transcribedText = res.text;
        loading.dismiss();
        this.cdr.detectChanges();
      },
      error: () => {
        loading.dismiss();
        this.showToast("Erreur sur le lien", 'danger');
      }
    });
  }

  // ==========================================
  // 🛠️ UTILS (Timer, Toast, Export)
  // ==========================================

  private startTimer() {
    this.recordingSeconds = 0;
    this.timerInterval = setInterval(() => {
      this.recordingSeconds++;
      const min = Math.floor(this.recordingSeconds / 60).toString().padStart(2, '0');
      const sec = (this.recordingSeconds % 60).toString().padStart(2, '0');
      this.recordingTime = `${min}:${sec}`;
    }, 1000);
  }

  private stopTimer() {
    clearInterval(this.timerInterval);
  }

  async copyText() {
    await Clipboard.write({ string: this.transcribedText });
    this.showToast('Copié !', 'success');
  }

  async showToast(msg: string, color: string = 'dark') {
    const toast = await this.toastCtrl.create({ message: msg, duration: 2000, color: color as any });
    toast.present();
  }

  // Garde tes fonctions downloadDocx(), downloadPdf(), etc.
  async presentDownloadActionSheet() {
    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Exporter',
      buttons: [
        { text: 'Word', icon: 'document-text', handler: () => this.downloadDocx() },
        { text: 'PDF', icon: 'document-attach', handler: () => this.downloadPdf() },
        { text: 'Annuler', role: 'cancel' }
      ]
    });
    await actionSheet.present();
  }

  downloadDocx() {
    const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun(this.transcribedText)] })] }] });
    Packer.toBlob(doc).then(blob => saveAs(blob, 'transcription.docx'));
  }

  downloadPdf() {
    const doc = new jsPDF();
    doc.text(doc.splitTextToSize(this.transcribedText, 180), 10, 10);
    doc.save('transcription.pdf');
  }
}