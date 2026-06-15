# Simple File Share

**Simple File Share** is a beautifully designed, standalone local network file sharing service. It provides a seamless experience for uploading, managing, and sharing files across devices on the same network. Built with an Apple-inspired photography-first design language, it runs as a sleek desktop application with an embedded server, and can be accessed from any web browser.

---

## ✨ Features

- **Apple-Inspired UI/UX**: Meticulously crafted using an Apple design system. Features edge-to-edge tiles, SF Pro typography with precise tracking, and a single Action Blue accent color. The interface recedes to let your content take center stage.
- **Drag & Drop Uploads**: Effortlessly upload files by dragging them directly into the browser or desktop app window.
- **Standalone Desktop App**: Runs as a standalone `.exe` built with Pywebview. No Python installation required for end users!
- **Local Network Sharing**: Automatically hosts a web server accessible by any device on your local network.
- **Real-Time System Logs**: Monitor server status, connections, and internal logs directly from the app interface.
- **Admin Dashboard**: Manage configuration settings such as port number, maximum upload size, and admin passwords.

---

## 🛠️ Technology Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy (SQLite), Uvicorn
- **Frontend**: HTML5, Vanilla CSS (Apple design system implementation), Vanilla Javascript
- **Desktop GUI**: Pywebview
- **Packaging**: PyInstaller

---

## 🚀 Getting Started (Development)

### Prerequisites
- Python 3.12 or higher

### Installation

1. **Clone the repository & create a virtual environment**:
   ```bash
   git clone <your-repo-url>
   cd SimpleFileShare
   python -m venv venv
   ```

2. **Activate the virtual environment**:
   - Windows:
     ```bash
     venv\Scripts\activate
     ```
   - macOS/Linux:
     ```bash
     source venv/bin/activate
     ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application**:
   ```bash
   python run.py
   ```
   *Note: On first run, if `config.json` is missing, it will automatically generate one using port `8000` and the default admin password `admin`.*

---

## 📦 Building for Production

To distribute the app as a single standalone executable (`.exe`) that doesn't require Python to be installed on the target Windows machine:

1. Ensure all dependencies are installed.
2. Run the build script from the root directory:
   ```cmd
   build.bat
   ```
3. The standalone executable will be generated in the `dist\` folder as `SimpleFileShare.exe`.

---

## 🎨 Design Philosophy

The frontend interface of Simple File Share is built entirely from scratch without CSS frameworks to strictly adhere to an Apple-inspired design language (detailed in `DESIGN.md`).

**Key Design Characteristics:**
- **Photography-First**: The UI chrome is minimal, letting the content speak.
- **Typography**: Uses `SF Pro Display` and `SF Pro Text` with negative letter-spacing at display sizes for the signature "Apple tight" feel.
- **Color Palette**: Relies on alternating full-bleed tiles (Pure White / Parchment / Near-Black) with a single `Action Blue` (#0066cc) for all interactive elements.
- **Elevation**: A single soft drop-shadow is used exclusively to give weight to elements resting on surfaces. No decorative gradients or unnecessary borders are used.

---

## 📝 License

This project is licensed under the MIT License.
