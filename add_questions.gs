/**
 * Agrega 5 preguntas tipo quiz (opción múltiple) al formulario.
 * Pegar en: Extensiones → Apps Script del formulario, guardar y Ejecutar `addQuestions`.
 * La primera ejecución pedirá autorización.
 */
function addQuestions() {
  var FORM_ID = '1G6fik3tsydhXnh4ssVdJ_oCqZQLuhNOmwbF9quakgNM';
  var form = FormApp.openById(FORM_ID);

  // Asegura que el form esté en modo cuestionario para usar respuestas correctas y puntaje
  form.setIsQuiz(true);

  var questions = [
    {
      title: '¿Qué se hace con los residuos en la recepción municipal?',
      options: [
        'Se botan sin revisar',
        'Se queman inmediatamente',
        'Se reciben, revisan y clasifican',
        'Se guardan sin orden'
      ],
      correct: 'Se reciben, revisan y clasifican',
      points: 1
    },
    {
      title: '¿Cuál es un riesgo común en el área?',
      options: [
        'Caídas por superficies resbalosas',
        'Dormir en el trabajo',
        'Comer en exceso',
        'Uso de celulares'
      ],
      correct: 'Caídas por superficies resbalosas',
      points: 1
    },
    {
      title: '¿Cuál es un elemento de protección personal (EPP)?',
      options: ['Mochila', 'Casco de seguridad', 'Cuaderno', 'Lápiz'],
      correct: 'Casco de seguridad',
      points: 1
    },
    {
      title: '¿Qué se debe hacer antes de comenzar el trabajo?',
      options: [
        'Irse temprano',
        'Organizar y planificar las tareas',
        'Descansar todo el día',
        'No hacer nada'
      ],
      correct: 'Organizar y planificar las tareas',
      points: 1
    },
    {
      title: '¿Qué indica un riesgo "alto"?',
      options: [
        'No hacer nada',
        'Requiere acción inmediata',
        'Es seguro',
        'Se puede ignorar'
      ],
      correct: 'Requiere acción inmediata',
      points: 1
    }
  ];

  questions.forEach(function (q) {
    var item = form.addMultipleChoiceItem();
    item.setTitle(q.title).setRequired(true);

    var choices = q.options.map(function (opt) {
      return item.createChoice(opt, opt === q.correct);
    });
    item.setChoices(choices);
    item.setPoints(q.points);
  });

  Logger.log('Listo: se agregaron ' + questions.length + ' preguntas.');
}
