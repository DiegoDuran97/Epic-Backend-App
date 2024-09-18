import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: {
      user: 'veronica.wunsch@ethereal.email',
      pass: 'kBy7ANavQzmRdTP3US'
  }
});

transporter.sendMail({
  from: '"Diego Duran" <diego.duran@torontomu.ca>', // sender address
  to: "veronica.wunsch@ethereal.email", // list of receivers
  subject: "Hello from FHIR Bootcamp 🔥", // Subject line
  html: "Your Patient Camila Lopez is <b>completely fine</b>.<br/>Or <em>is she?</em>", // html body
}).then(info => console.log(info))  